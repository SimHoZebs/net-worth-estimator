import { z } from "zod";
import type { FinancialModelDocument, PlanPresentation } from "../api/index.ts";
import {
	getResourceScope,
	resourceStorageKey,
	type ResourceScope,
} from "../auth/resourceScope.ts";
import { isRecord } from "../domain/guards.ts";
import { type Plan, planSchema } from "../domain/model.ts";
import { StorageError } from "./storage.ts";

export const REMOTE_STORAGE_KEY = "waypoint.remote-workspace.v1";

/** Unscoped v1 drafts stay untouched. Their owner cannot be established safely. */
export function remoteStorageKey(scope = getResourceScope()): string | null {
	return resourceStorageKey(REMOTE_STORAGE_KEY, scope);
}

function storageScopeError(): StorageError {
	return new StorageError({
		detail: "Verify your session before accessing browser workspace data.",
	});
}

function isPlanPresentation(value: unknown): value is PlanPresentation {
	return (
		isRecord(value) && isRecord(value.accounts) && isRecord(value.movements)
	);
}

const planPresentationSchema = z.custom<PlanPresentation>(isPlanPresentation, {
	message: "The stored plan presentation could not be validated.",
});
const remoteStateSchema = z.object({
	version: z.literal(1),
	draft: planSchema.nullable(),
	draftPresentation: planPresentationSchema.nullable(),
	baseFingerprint: z.string().min(1).nullable().optional(),
	baseRevision: z.string().min(1).nullable().optional(),
});

export interface RemoteLocalState {
	version: 1;
	draft: Plan | null;
	draftPresentation: PlanPresentation | null;
	baseFingerprint?: string | null;
	baseRevision?: string | null;
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number")
		return Object.is(value, -0) ? "0" : String(value);
	if (Array.isArray(value))
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const fields = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
		return `{${fields.join(",")}}`;
	}
	return "null";
}

function stableHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function serverDocumentFingerprint(
	document: FinancialModelDocument,
): string {
	const semanticDocument = {
		sourcePath: document.sourcePath,
		accounts: document.accounts.map(
			({ id, name, minBalance, maxBalance, color, enabled }) => ({
				id,
				name,
				minBalance,
				maxBalance,
				color,
				enabled,
			}),
		),
		checkpoints: document.checkpoints.map(
			({ Date: date, AccountId, Balance, source }) => ({
				Date: date,
				AccountId,
				Balance,
				...(source === undefined ? {} : { source }),
			}),
		),
		evaluations: {
			financialIndependence: document.evaluations.financialIndependence.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			netWorthThreshold: document.evaluations.netWorthThreshold.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			accountBalance: document.evaluations.accountBalance.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			postingFulfillment: document.evaluations.postingFulfillment.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			cycleFulfillment: (document.evaluations.cycleFulfillment ?? []).map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
		},
		postings: document.postings.map(
			({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				postedTime,
				transactionTime,
				claim,
				enabled,
				source,
			}) => ({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				postedTime,
				transactionTime,
				claim,
				enabled,
				...(source === undefined ? {} : { source }),
			}),
		),
		recurrenceRules: (document.recurrenceRules ?? []).map(
			({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				frequency,
				startDate,
				endDate,
				annualCap,
				priority,
				enabled,
			}) => ({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				frequency,
				startDate,
				endDate,
				annualCap,
				priority,
				enabled,
			}),
		),
	};
	return `v1:${stableHash(canonicalJson(semanticDocument))}`;
}

export function readRemoteStateRaw(
	scope: ResourceScope = getResourceScope(),
): string | StorageError | null {
	try {
		const key = remoteStorageKey(scope);
		if (!key || scope !== getResourceScope()) return storageScopeError();
		if (typeof localStorage === "undefined")
			return new StorageError({ detail: "Browser storage is unavailable." });
		return localStorage.getItem(key);
	} catch (cause) {
		return new StorageError({
			detail: "The stored remote workspace could not be read.",
			cause,
		});
	}
}

export function loadRemoteState(
	scope: ResourceScope = getResourceScope(),
): RemoteLocalState | StorageError | null {
	const raw = readRemoteStateRaw(scope);
	if (raw instanceof Error || raw === null) return raw;
	try {
		const parsed = remoteStateSchema.safeParse(JSON.parse(raw));
		if (!parsed.success)
			return new StorageError({
				detail: "Stored remote workspace data could not be validated.",
				cause: parsed.error,
			});
		return parsed.data;
	} catch (cause) {
		return new StorageError({
			detail: "Stored remote workspace data could not be read.",
			cause,
		});
	}
}

export function persistRemoteState(
	state: RemoteLocalState,
	expectedRaw?: string | null,
	scope: ResourceScope = getResourceScope(),
): StorageError | null {
	try {
		const key = remoteStorageKey(scope);
		if (!key || scope !== getResourceScope()) return storageScopeError();
		if (typeof localStorage === "undefined")
			return new StorageError({ detail: "Browser storage is unavailable." });
		if (
			expectedRaw !== undefined &&
			localStorage.getItem(key) !== expectedRaw
		) {
			return new StorageError({
				detail:
					"This remote workspace was changed in another tab. Reload the latest server model.",
			});
		}
		localStorage.setItem(key, JSON.stringify(state));
		return null;
	} catch (cause) {
		return new StorageError({
			detail: "This browser could not store remote workspace data.",
			cause,
		});
	}
}
