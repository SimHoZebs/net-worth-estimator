import { parseFinancialModelDocument } from "../sources/csv/csvDataSource";
import type { FinancialModelDocument } from "../types/model";
import {
	createFinancialModelRecord,
	type FinancialModelDao,
	type FinancialModelDaoRead,
	type FinancialModelRecord,
	type FinancialModelStorageLifecycle,
} from "./financialModelPersistence";

const RECORD_FORMAT = "financial-model-record-v1";

interface CheckpointSurrogate {
	index: number;
	kind: "opening" | "adjustment";
	date: string;
	accountId: string;
	delta: number;
}

interface StoredFinancialModelRecord {
	format: typeof RECORD_FORMAT;
	version: string;
	provenance: FinancialModelRecord["provenance"];
	document: FinancialModelDocument;
}

export interface FinancialModelStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface FinancialModelStorageLock {
	run<T>(operation: () => T | Promise<T>): Promise<T>;
}

export function createInProcessFinancialModelStorageLock(): FinancialModelStorageLock {
	let pending = Promise.resolve();
	return {
		run<T>(operation: () => T | Promise<T>): Promise<T> {
			const result = pending.then(operation, operation);
			pending = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
	};
}

export function createWebFinancialModelStorageLock(
	locks: LockManager,
	name: string,
): FinancialModelStorageLock {
	return {
		run<T>(operation: () => T | Promise<T>): Promise<T> {
			return locks.request(name, { mode: "exclusive" }, operation);
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCheckpointSurrogate(
	value: unknown,
	index: number,
): CheckpointSurrogate | null {
	if (!isRecord(value) || typeof value.id !== "string") return null;
	const match = /^(opening|adjustment)_(\d{4})(\d{2})(\d{2})_(.+)$/u.exec(
		value.id,
	);
	if (!match) return null;
	const [, kind, year, month, day, accountId] = match;
	const date = `${year}-${month}-${day}`;
	if (
		(kind !== "opening" && kind !== "adjustment") ||
		!accountId ||
		value.frequency !== "once" ||
		value.startDate !== date ||
		value.endDate !== null ||
		value.annualRate !== 0 ||
		value.annualGrowthRate !== 0 ||
		value.volatility !== 0 ||
		value.annualCap !== null ||
		value.priority !== 1 ||
		value.enabled !== true ||
		!isRecord(value.amount) ||
		value.amount.resolver !== "expression" ||
		!isRecord(value.amount.config) ||
		typeof value.amount.config.expression !== "string" ||
		!isRecord(value.amount.inputs) ||
		Object.keys(value.amount.inputs).length !== 0
	) {
		return null;
	}
	const amount = Number(value.amount.config.expression);
	if (!Number.isFinite(amount) || amount < 0) return null;

	const isInflow =
		value.sourceAccountId === null &&
		Array.isArray(value.destinations) &&
		value.destinations.length === 1 &&
		value.destinations[0] === accountId;
	const isOutflow =
		value.sourceAccountId === accountId && value.destinations === null;
	if (!isInflow && !isOutflow) return null;

	return {
		index,
		kind,
		date,
		accountId,
		delta: isOutflow ? -amount : amount,
	};
}

function upgradeCheckpointSurrogates(value: unknown): unknown {
	if (!isRecord(value) || !Array.isArray(value.postings)) return value;
	if (Array.isArray(value.checkpoints) && value.checkpoints.length > 0) {
		return value;
	}

	const surrogates = value.postings
		.map(parseCheckpointSurrogate)
		.filter((surrogate): surrogate is CheckpointSurrogate => surrogate !== null)
		.sort(
			(left, right) =>
				left.date.localeCompare(right.date) || left.index - right.index,
		);
	if (surrogates.length === 0) return value;

	const balances = new Map<string, number>();
	const checkpoints = surrogates.map((surrogate) => {
		const balance =
			surrogate.kind === "opening"
				? surrogate.delta
				: (balances.get(surrogate.accountId) ?? 0) + surrogate.delta;
		balances.set(surrogate.accountId, balance);
		return {
			Date: surrogate.date,
			AccountId: surrogate.accountId,
			Balance: balance,
		};
	});
	const surrogateIndexes = new Set(
		surrogates.map((surrogate) => surrogate.index),
	);
	return {
		...value,
		checkpoints,
		postings: value.postings.filter((_, index) => !surrogateIndexes.has(index)),
	};
}

function parseProvenance(
	value: unknown,
): FinancialModelRecord["provenance"] | null {
	if (!isRecord(value) || typeof value.type !== "string") return null;
	if (value.type === "user") return { type: "user" };
	if (
		value.type === "source" &&
		typeof value.sourceId === "string" &&
		typeof value.revision === "string"
	) {
		return {
			type: "source",
			sourceId: value.sourceId,
			revision: value.revision,
		};
	}
	return null;
}

function parseStoredRecord(value: unknown): FinancialModelRecord | null {
	if (
		!isRecord(value) ||
		value.format !== RECORD_FORMAT ||
		typeof value.version !== "string"
	) {
		return null;
	}
	const provenance = parseProvenance(value.provenance);
	const document = parseFinancialModelDocument(
		upgradeCheckpointSurrogates(value.document),
	);
	return provenance && document
		? { version: value.version, provenance, document }
		: null;
}

function serializeRecord(record: FinancialModelRecord): string {
	const stored: StoredFinancialModelRecord = {
		format: RECORD_FORMAT,
		version: record.version,
		provenance: record.provenance,
		document: record.document,
	};
	return JSON.stringify(stored);
}

export class LocalStorageFinancialModelDao
	implements FinancialModelDao, FinancialModelStorageLifecycle
{
	constructor(
		private readonly storage: FinancialModelStorage,
		private readonly storageKey: string,
		private readonly lock: FinancialModelStorageLock,
	) {}

	async read(): Promise<FinancialModelDaoRead> {
		return this.lock.run(() => this.readStoredRecord());
	}

	async replace(record: FinancialModelRecord): Promise<void> {
		await this.lock.run(() => {
			this.storage.setItem(this.storageKey, serializeRecord(record));
		});
	}

	async replaceIfVersion(
		expectedVersion: string | null,
		record: FinancialModelRecord,
	): Promise<boolean> {
		return this.lock.run(() => {
			const current = this.readStoredRecord();
			const currentVersion =
				current.status === "found" ? current.record.version : null;
			if (current.status === "corrupt" || currentVersion !== expectedVersion) {
				return false;
			}
			this.storage.setItem(this.storageKey, serializeRecord(record));
			return true;
		});
	}

	async clear(): Promise<void> {
		await this.lock.run(() => {
			this.storage.removeItem(this.storageKey);
		});
	}

	private readStoredRecord(): FinancialModelDaoRead {
		let serialized: string | null;
		try {
			serialized = this.storage.getItem(this.storageKey);
		} catch {
			return { status: "corrupt" };
		}
		if (serialized === null) return { status: "absent" };

		try {
			const value: unknown = JSON.parse(serialized);
			const storedRecord = parseStoredRecord(value);
			if (storedRecord) {
				const canonical = serializeRecord(storedRecord);
				if (canonical !== serialized) this.tryWrite(canonical);
				return { status: "found", record: storedRecord };
			}

			const legacyDocument = parseFinancialModelDocument(
				upgradeCheckpointSurrogates(value),
			);
			if (legacyDocument) {
				const upgraded = createFinancialModelRecord(legacyDocument, {
					type: "user",
				});
				this.tryWrite(serializeRecord(upgraded));
				return { status: "found", record: upgraded };
			}
		} catch {
			// A present but invalid canonical record must not fall back to ingestion.
		}
		return { status: "corrupt" };
	}

	private tryWrite(value: string): void {
		try {
			this.storage.setItem(this.storageKey, value);
		} catch {
			// A canonical read remains usable when an opportunistic upgrade cannot persist.
		}
	}
}
