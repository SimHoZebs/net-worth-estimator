import { canonicalSerialize } from "../artifacts/canonical";
import { sha256 } from "../artifacts/digest";
import type { FinancialModelParseResult } from "../modelRepository";
import type { FinancialModelDocument } from "../types/model";
import type { ModelValidationIssue } from "../types/validation";

export interface SourceProvenance {
	type: "source";
	sourceId: string;
	revision: string;
}

export interface UserProvenance {
	type: "user";
}

export interface FinancialModelRecord {
	version: string;
	provenance: SourceProvenance | UserProvenance;
	document: FinancialModelDocument;
}

export type FinancialModelDaoRead =
	| { status: "absent" }
	| { status: "corrupt" }
	| { status: "found"; record: FinancialModelRecord };

export interface FinancialModelDao {
	read(): Promise<FinancialModelDaoRead>;
	replace(record: FinancialModelRecord): Promise<void>;
	replaceIfVersion(
		expectedVersion: string | null,
		record: FinancialModelRecord,
	): Promise<boolean>;
}

export interface FinancialModelStorageLifecycle {
	clear(): Promise<void>;
}

export interface FinancialModelSourceSnapshot {
	sourceId: string;
	revision: string | null;
	result: FinancialModelParseResult;
}

export interface FinancialModelIngestionSource {
	load(): Promise<FinancialModelSourceSnapshot>;
}

export interface IngestionSynchronizationResult
	extends FinancialModelParseResult {
	changed: boolean;
}

function hasErrors(result: FinancialModelParseResult): boolean {
	return result.issues.some((issue) => issue.severity === "error");
}

function corruptStorageIssue(): ModelValidationIssue {
	return {
		severity: "error",
		code: "browser.storage.invalid",
		message: "Saved financial model storage is corrupt or is not canonical.",
		path: [],
	};
}

function sourceFailureIssue(error: unknown): ModelValidationIssue {
	return {
		severity: "warning",
		code: "ingestion.source.unavailable",
		message: `The ingestion source could not be checked: ${
			error instanceof Error ? error.message : String(error)
		}. The last persisted model is still available.`,
		path: [],
	};
}

export function createFinancialModelRecord(
	document: FinancialModelDocument,
	provenance: FinancialModelRecord["provenance"],
): FinancialModelRecord {
	return {
		version: globalThis.crypto.randomUUID(),
		provenance,
		document,
	};
}

export async function financialModelSourceRevision(
	document: FinancialModelDocument,
): Promise<string> {
	return sha256(
		canonicalSerialize({
			accounts: document.accounts,
			checkpoints: document.checkpoints,
			evaluations: document.evaluations,
			postings: document.postings,
		}),
	);
}

export class FinancialModelIngestionCoordinator {
	constructor(
		private readonly source: FinancialModelIngestionSource,
		private readonly dao: FinancialModelDao,
	) {}

	async synchronize(): Promise<IngestionSynchronizationResult> {
		const current = await this.dao.read();
		if (current.status === "corrupt") {
			return {
				document: null,
				issues: [corruptStorageIssue()],
				changed: false,
			};
		}
		if (
			current.status === "found" &&
			current.record.provenance.type === "user"
		) {
			return {
				document: current.record.document,
				issues: [],
				changed: false,
			};
		}

		let snapshot: FinancialModelSourceSnapshot;
		try {
			snapshot = await this.source.load();
		} catch (error) {
			if (current.status === "found") {
				return {
					document: current.record.document,
					issues: [sourceFailureIssue(error)],
					changed: false,
				};
			}
			throw error;
		}

		if (
			current.status === "found" &&
			current.record.provenance.type === "source" &&
			current.record.provenance.sourceId === snapshot.sourceId &&
			current.record.provenance.revision === snapshot.revision
		) {
			return {
				document: current.record.document,
				issues: snapshot.result.issues,
				changed: false,
			};
		}

		if (
			!snapshot.result.document ||
			!snapshot.revision ||
			hasErrors(snapshot.result)
		) {
			return {
				document:
					current.status === "found"
						? current.record.document
						: snapshot.result.document,
				issues: snapshot.result.issues,
				changed: false,
			};
		}

		const next = createFinancialModelRecord(snapshot.result.document, {
			type: "source",
			sourceId: snapshot.sourceId,
			revision: snapshot.revision,
		});
		const expectedVersion =
			current.status === "found" ? current.record.version : null;
		const replaced = await this.dao.replaceIfVersion(expectedVersion, next);
		if (replaced) {
			return { ...snapshot.result, changed: true };
		}

		const winner = await this.dao.read();
		if (winner.status === "found") {
			return {
				document: winner.record.document,
				issues: [],
				changed: false,
			};
		}
		if (winner.status === "corrupt") {
			return {
				document: null,
				issues: [corruptStorageIssue()],
				changed: false,
			};
		}
		return { ...snapshot.result, changed: false };
	}
}
