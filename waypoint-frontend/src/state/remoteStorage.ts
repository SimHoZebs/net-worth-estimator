import { z } from "zod";
import type { FinancialModelDocument, PlanSidecar } from "../api/index.ts";
import { type Plan, planSchema } from "../domain/model.ts";
import { type Snapshot, StorageError, snapshotSchema } from "./storage.ts";

export const REMOTE_STORAGE_KEY = "waypoint.remote-workspace.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanSidecar(value: unknown): value is PlanSidecar {
	if (!isRecord(value) || value.version !== 1 || !isRecord(value.presentation))
		return false;
	const presentation = value.presentation;
	return (
		isRecord(presentation.accounts) &&
		isRecord(presentation.movements) &&
		Array.isArray(presentation.reserveGoals) &&
		Array.isArray(presentation.provisionalFields) &&
		presentation.provisionalFields.every((item) => typeof item === "string")
	);
}

const planSidecarSchema = z.custom<PlanSidecar>(isPlanSidecar, {
	message: "The stored plan sidecar could not be validated.",
});
const remoteStateSchema = z.object({
	version: z.literal(1),
	draft: planSchema.nullable(),
	draftSidecar: planSidecarSchema.nullable(),
	baseFingerprint: z.string().min(1).nullable().optional(),
	baseRevision: z.string().min(1).nullable().optional(),
	snapshot: snapshotSchema.nullable(),
});

export interface RemoteLocalState {
	version: 1;
	draft: Plan | null;
	draftSidecar: PlanSidecar | null;
	baseFingerprint?: string | null;
	baseRevision?: string | null;
	snapshot: Snapshot | null;
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
			({ id, label, minBalance, maxBalance, color, enabled }) => ({
				id,
				label,
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
				({ instanceId, label, enabled, config }) => ({
					instanceId,
					label,
					enabled,
					config,
				}),
			),
			netWorthThreshold: document.evaluations.netWorthThreshold.map(
				({ instanceId, label, enabled, config }) => ({
					instanceId,
					label,
					enabled,
					config,
				}),
			),
			postingFulfillment: document.evaluations.postingFulfillment.map(
				({ instanceId, label, enabled, config }) => ({
					instanceId,
					label,
					enabled,
					config,
				}),
			),
		},
		postings: document.postings.map(
			({
				id,
				label,
				sourceAccountId,
				destinations,
				amount,
				frequency,
				annualRate,
				annualGrowthRate,
				volatility,
				startDate,
				endDate,
				annualCap,
				priority,
				enabled,
				source,
			}) => ({
				id,
				label,
				sourceAccountId,
				destinations,
				amount,
				frequency,
				annualRate,
				annualGrowthRate,
				volatility,
				startDate,
				endDate,
				annualCap,
				priority,
				enabled,
				...(source === undefined ? {} : { source }),
			}),
		),
	};
	return `v1:${stableHash(canonicalJson(semanticDocument))}`;
}

export function readRemoteStateRaw(): string | StorageError | null {
	try {
		if (typeof localStorage === "undefined")
			return new StorageError({ detail: "Browser storage is unavailable." });
		return localStorage.getItem(REMOTE_STORAGE_KEY);
	} catch (cause) {
		return new StorageError({
			detail: "The stored remote workspace could not be read.",
			cause,
		});
	}
}

export function loadRemoteState(): RemoteLocalState | StorageError | null {
	const raw = readRemoteStateRaw();
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
): StorageError | null {
	try {
		if (typeof localStorage === "undefined")
			return new StorageError({ detail: "Browser storage is unavailable." });
		if (
			expectedRaw !== undefined &&
			localStorage.getItem(REMOTE_STORAGE_KEY) !== expectedRaw
		) {
			return new StorageError({
				detail:
					"This remote workspace was changed in another tab. Export your temporary work, then reload the latest server model.",
			});
		}
		localStorage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(state));
		return null;
	} catch (cause) {
		return new StorageError({
			detail: "This browser could not store remote workspace data.",
			cause,
		});
	}
}
