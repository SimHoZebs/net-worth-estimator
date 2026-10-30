import type { BackendPlannedPurchase } from "@/api/contracts.ts";
import { applyRowOperations, type RowOperation } from "@/api/rowSync.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import type { PlannedPurchase } from "@/domain/model.ts";
import { movePurchase } from "@/domain/purchases.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { modelOptions, userResourceKey } from "@/state/workspaceResources.ts";
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

export function createPurchaseOperation(
	purchase: PlannedPurchase,
	priority: number,
): RowOperation {
	return {
		kind: "plannedPurchase",
		action: "create",
		row: purchaseRow(purchase, priority),
	};
}

export function updatePurchaseOperation(
	purchase: PlannedPurchase,
	priority: number,
): RowOperation {
	return {
		kind: "plannedPurchase",
		action: "update",
		id: purchase.id,
		row: purchaseRow(purchase, priority),
	};
}

export function deletePurchaseOperation(id: string): RowOperation {
	return { kind: "plannedPurchase", action: "delete", id };
}

export interface PurchaseReorder {
	operations: RowOperation[];
	next: PlannedPurchase[];
}

/**
 * Targeted reorder operations for one queue move. Every row whose queue
 * index changed gets a priority update, plus one move for the relocated
 * row so row position tracks priority. Returns null when the move is a
 * no-op. The returned operations run sequentially and are not atomic:
 * callers must refresh authoritative state after a partial failure.
 */
export function movePurchaseOperations(
	purchases: PlannedPurchase[],
	id: string,
	direction: -1 | 1,
): PurchaseReorder | null {
	const next = movePurchase(purchases, id, direction);
	if (next === purchases) return null;
	const previousIndex = new Map(
		purchases.map((purchase, index) => [purchase.id, index]),
	);
	const operations: RowOperation[] = [];
	next.forEach((purchase, index) => {
		if (previousIndex.get(purchase.id) !== index)
			operations.push(updatePurchaseOperation(purchase, index));
	});
	const at = next.findIndex((purchase) => purchase.id === id);
	operations.push({
		kind: "plannedPurchase",
		action: "move",
		id,
		beforeId: next[at + 1]?.id ?? null,
	});
	return { operations, next };
}

/** Refetch the authoritative model after a purchase save attempt. */
export async function refreshPurchases(): Promise<void> {
	const scope = getUserScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: userResourceKey("model", scope),
		refetchType: "none",
	});
	if (scope !== getUserScope() || scope.status !== "ready") return;
	// A reload failure propagates: performSave reports "saved but not
	// reloaded" instead of claiming success on stale data.
	await cache.fetchQuery(modelOptions(scope));
}

/**
 * Persist targeted purchase operations through the shared save lifecycle,
 * which alone owns guards, scope capture, notices, and the authoritative
 * refresh on every outcome. Returns true only when the server persisted
 * every operation and the refresh confirmed it for the same resource.
 */
export async function persistPurchaseOperations(
	operations: RowOperation[],
	failureMessage: string,
): Promise<boolean> {
	if (!operations.length) return true;
	return performSave({
		call: async () => {
			const result = await applyRowOperations(operations);
			// A thrown result surfaces through performSave's failure path.
			if (result instanceof Error) throw result;
			return { data: { persisted: result.ok, issues: result.issues } };
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
