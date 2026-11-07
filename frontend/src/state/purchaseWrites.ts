import type { BackendPlannedPurchase } from "@/api/contracts.ts";
import { ApiHttpError } from "@/api/http.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import {
	createPlannedPurchase,
	deletePlannedPurchase,
	movePlannedPurchase,
	updatePlannedPurchase,
} from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import type { PlannedPurchase } from "@/domain/model.ts";
import { movePurchase } from "@/domain/purchases.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import {
	purchasesOptions,
	userResourceKey,
} from "@/state/workspaceResources.ts";
import { performSave } from "./workspaceWrites.ts";

/**
 * Row-first purchase writes use the dedicated planned-purchase API.
 */

/** Backend row for one planned purchase. Priority is the queue index. */
export function purchaseRow(
	purchase: PlannedPurchase,
	priority: number,
): BackendPlannedPurchase {
	return {
		id: purchase.id,
		name: purchase.name,
		fundingAccountId: purchase.fromId,
		cost: purchase.amount,
		earliestDate: purchase.startDate,
		enabled: purchase.enabled,
		priority,
	};
}

export type PurchaseOperation =
	| { kind: "plannedPurchase"; action: "create"; value: BackendPlannedPurchase }
	| {
			kind: "plannedPurchase";
			action: "update";
			id: string;
			value: BackendPlannedPurchase;
	  }
	| { kind: "plannedPurchase"; action: "delete"; id: string }
	| {
			kind: "plannedPurchase";
			action: "move";
			id: string;
			beforeId: string | null;
	  };

export function createPurchaseOperation(
	purchase: PlannedPurchase,
	priority: number,
): PurchaseOperation {
	return {
		kind: "plannedPurchase",
		action: "create",
		value: purchaseRow(purchase, priority),
	};
}

export function updatePurchaseOperation(
	purchase: PlannedPurchase,
	priority: number,
): PurchaseOperation {
	return {
		kind: "plannedPurchase",
		action: "update",
		id: purchase.id,
		value: purchaseRow(purchase, priority),
	};
}

export function deletePurchaseOperation(id: string): PurchaseOperation {
	return { kind: "plannedPurchase", action: "delete", id };
}

export interface PurchaseReorder {
	operations: PurchaseOperation[];
	next: PlannedPurchase[];
}

/**
 * One reorder operation for one queue move. The server move renumbers every
 * priority from row position, so separate priority updates would only add
 * writes and projection rebuilds. Returns null when the move is a no-op.
 */
export function movePurchaseOperations(
	purchases: PlannedPurchase[],
	id: string,
	direction: -1 | 1,
): PurchaseReorder | null {
	const next = movePurchase(purchases, id, direction);
	if (next === purchases) return null;
	const at = next.findIndex((purchase) => purchase.id === id);
	const operations: PurchaseOperation[] = [
		{
			kind: "plannedPurchase",
			action: "move",
			id,
			beforeId: next[at + 1]?.id ?? null,
		},
	];
	return { operations, next };
}

function runOperation(operation: PurchaseOperation): Promise<unknown> {
	switch (operation.action) {
		case "create":
			return createPlannedPurchase(operation.value);
		case "update":
			return updatePlannedPurchase(operation.id, operation.value);
		case "delete":
			return deletePlannedPurchase(operation.id);
		case "move":
			return movePlannedPurchase({
				id: operation.id,
				beforeId: operation.beforeId ?? "",
			});
	}
}

/**
 * Persist operations in order. A scope change retires every remaining write
 * instead of sending a request computed for one user against another user's
 * workspace.
 */
type WriteEnvelope = {
	saved?: boolean;
	issues?: { severity: string; message?: string | null }[];
};

async function runOperations(
	operations: PurchaseOperation[],
): Promise<WriteEnvelope> {
	const scope = getUserScope();
	for (const operation of operations) {
		if (scope !== getUserScope()) throw new UserScopeError();
		const response = (await runOperation(operation)) as {
			data?: WriteEnvelope;
		};
		if (response.data?.saved === false) {
			return { saved: false, issues: response.data.issues ?? [] };
		}
	}
	return { saved: true, issues: [] };
}

/** Refetch the authoritative purchase queue after a save attempt. */
export async function refreshPurchases(): Promise<void> {
	const scope = getUserScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: userResourceKey("purchases", scope),
		refetchType: "none",
	});
	if (scope !== getUserScope() || scope.status !== "ready") return;
	// A reload failure propagates: performSave reports "saved but not
	// reloaded" instead of claiming success on stale data.
	await Promise.all([
		cache.fetchQuery(purchasesOptions(scope)),
	]);
}

/**
 * Persist targeted purchase operations through the shared save lifecycle,
 * which alone owns guards, scope capture, notices, and the authoritative
 * refresh on every outcome. Returns true only when the server persisted
 * every operation and the refresh confirmed it for the same resource.
 */
export async function persistPurchaseOperations(
	operations: PurchaseOperation[],
	failureMessage: string,
): Promise<boolean> {
	if (!operations.length) return true;
	return performSave({
		call: async () => {
			try {
				return { data: await runOperations(operations) };
			} catch (cause) {
				if (cause instanceof UserScopeError) throw cause;
				throw cause instanceof ApiHttpError ? cause : new Error(failureMessage);
			}
		},
		refresh: refreshPurchases,
		failureMessage,
	});
}

/** Append one planned purchase at the end of the queue. */
export async function saveNewPurchase(
	purchase: PlannedPurchase,
	priority: number,
): Promise<boolean> {
	return persistPurchaseOperations(
		[createPurchaseOperation(purchase, priority)],
		"The purchase could not be added.",
	);
}

/** Persist an edit without moving the row in the queue. */
export async function savePurchaseEdit(
	purchase: PlannedPurchase,
	priority: number,
): Promise<boolean> {
	return persistPurchaseOperations(
		[updatePurchaseOperation(purchase, priority)],
		"The purchase could not be saved.",
	);
}

/** Remove one planned purchase. Remaining priorities keep their relative order. */
export async function removeSavedPurchase(id: string): Promise<boolean> {
	return persistPurchaseOperations(
		[deletePurchaseOperation(id)],
		"The purchase could not be removed.",
	);
}

export interface PurchaseMoveResult {
	ok: boolean;
	next: PlannedPurchase[] | null;
}

/** Move one row in the queue and persist the new priority. */
export async function moveSavedPurchase(
	purchases: PlannedPurchase[],
	id: string,
	direction: -1 | 1,
): Promise<PurchaseMoveResult> {
	const reorder = movePurchaseOperations(purchases, id, direction);
	if (!reorder) return { ok: true, next: null };
	const ok = await persistPurchaseOperations(
		reorder.operations,
		"The purchase could not be moved.",
	);
	return { ok, next: ok ? reorder.next : null };
}
