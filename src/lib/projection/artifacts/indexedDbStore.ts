import {
	assertProjectionArtifactEnvelope,
	isProjectionArtifactEnvelope,
	type ProjectionArtifactEnvelope,
} from "./envelope";
import { assertArtifactKey, type ProjectionArtifactStore } from "./store";

export const PROJECTION_ARTIFACT_DATABASE_NAME =
	"net-worth-estimator:projection-artifacts";
export const PROJECTION_ARTIFACT_STORE_NAME = "artifacts";

const DATABASE_VERSION = 1;
const CREATED_AT_INDEX = "createdAt";
const DEFAULT_MAX_ENTRIES = 250;

interface StoredArtifact<TPayload> {
	key: string;
	createdAt: number;
	envelope: ProjectionArtifactEnvelope<TPayload>;
}

export interface IndexedDbProjectionArtifactStoreOptions {
	databaseName?: string;
	maxEntries?: number;
	indexedDB?: IDBFactory;
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed."));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
	});
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB request failed."));
	});
}

function readEnvelope<TPayload>(
	record: StoredArtifact<TPayload> | undefined,
): ProjectionArtifactEnvelope<TPayload> | undefined {
	if (record === undefined) return undefined;
	if (!isStoredArtifact(record)) {
		throw new TypeError("Invalid projection artifact record in IndexedDB.");
	}
	return record.envelope;
}

function isStoredArtifact<TPayload>(
	value: unknown,
): value is StoredArtifact<TPayload> {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<StoredArtifact<TPayload>>;
	return (
		typeof record.key === "string" &&
		typeof record.createdAt === "number" &&
		Number.isFinite(record.createdAt) &&
		isProjectionArtifactEnvelope(record.envelope)
	);
}

export class IndexedDbProjectionArtifactStore<TPayload = unknown>
	implements ProjectionArtifactStore<TPayload>
{
	private readonly databaseName: string;
	private readonly maxEntries: number;
	private readonly indexedDBFactory: IDBFactory | undefined;
	private databasePromise: Promise<IDBDatabase> | undefined;

	constructor(options: IndexedDbProjectionArtifactStoreOptions = {}) {
		this.databaseName =
			options.databaseName ?? PROJECTION_ARTIFACT_DATABASE_NAME;
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.indexedDBFactory = options.indexedDB;
		if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
			throw new TypeError("maxEntries must be a positive integer.");
		}
	}

	async get(
		key: string,
	): Promise<ProjectionArtifactEnvelope<TPayload> | undefined> {
		assertArtifactKey(key);
		const database = await this.openDatabase();
		const transaction = database.transaction(
			PROJECTION_ARTIFACT_STORE_NAME,
			"readonly",
		);
		const request = transaction
			.objectStore(PROJECTION_ARTIFACT_STORE_NAME)
			.get(key) as IDBRequest<StoredArtifact<TPayload> | undefined>;
		const [record] = await Promise.all([
			requestResult(request),
			transactionComplete(transaction),
		]);
		return readEnvelope(record);
	}

	async delete(key: string): Promise<void> {
		assertArtifactKey(key);
		const database = await this.openDatabase();
		const transaction = database.transaction(
			PROJECTION_ARTIFACT_STORE_NAME,
			"readwrite",
		);
		transaction.objectStore(PROJECTION_ARTIFACT_STORE_NAME).delete(key);
		await transactionComplete(transaction);
	}

	async putIfAbsent(
		key: string,
		envelope: ProjectionArtifactEnvelope<TPayload>,
	): Promise<ProjectionArtifactEnvelope<TPayload>> {
		assertArtifactKey(key);
		assertProjectionArtifactEnvelope(envelope);
		const database = await this.openDatabase();
		const winner = await this.addOrReadWinner(database, key, envelope);
		await this.prune(database).catch(() => undefined);
		return winner;
	}

	private openDatabase(): Promise<IDBDatabase> {
		if (this.databasePromise !== undefined) return this.databasePromise;

		const opening = new Promise<IDBDatabase>((resolve, reject) => {
			const factory = this.indexedDBFactory ?? globalThis.indexedDB;
			if (factory === undefined) {
				reject(new Error("IndexedDB is unavailable."));
				return;
			}

			const request = factory.open(this.databaseName, DATABASE_VERSION);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (
					!database.objectStoreNames.contains(PROJECTION_ARTIFACT_STORE_NAME)
				) {
					const store = database.createObjectStore(
						PROJECTION_ARTIFACT_STORE_NAME,
						{ keyPath: "key" },
					);
					store.createIndex(CREATED_AT_INDEX, "createdAt");
				}
			};
			request.onsuccess = () => {
				const database = request.result;
				database.onversionchange = () => {
					database.close();
					this.databasePromise = undefined;
				};
				resolve(database);
			};
			request.onerror = () =>
				reject(request.error ?? new Error("Unable to open IndexedDB."));
			request.onblocked = () =>
				reject(
					new Error("Opening the projection artifact database was blocked."),
				);
		});

		this.databasePromise = opening.catch((error: unknown) => {
			this.databasePromise = undefined;
			throw error;
		});
		return this.databasePromise;
	}

	private addOrReadWinner(
		database: IDBDatabase,
		key: string,
		envelope: ProjectionArtifactEnvelope<TPayload>,
	): Promise<ProjectionArtifactEnvelope<TPayload>> {
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(
				PROJECTION_ARTIFACT_STORE_NAME,
				"readwrite",
			);
			const store = transaction.objectStore(PROJECTION_ARTIFACT_STORE_NAME);
			const persistedEnvelope = structuredClone(envelope);
			const record: StoredArtifact<TPayload> = {
				key,
				createdAt: Date.parse(persistedEnvelope.createdAt),
				envelope: persistedEnvelope,
			};
			let winner: ProjectionArtifactEnvelope<TPayload> | undefined;
			let operationError: Error | undefined;
			const addRequest = store.add(record);

			addRequest.onsuccess = () => {
				winner = structuredClone(persistedEnvelope);
			};
			addRequest.onerror = (event) => {
				if (addRequest.error?.name !== "ConstraintError") return;
				event.preventDefault();
				event.stopPropagation();
				const getRequest = store.get(key) as IDBRequest<
					StoredArtifact<TPayload> | undefined
				>;
				getRequest.onsuccess = () => {
					try {
						winner = readEnvelope(getRequest.result);
						if (winner === undefined) {
							throw new Error("The winning artifact could not be retrieved.");
						}
					} catch (error) {
						operationError =
							error instanceof Error ? error : new Error(String(error));
						transaction.abort();
					}
				};
			};

			transaction.oncomplete = () => {
				if (winner === undefined) {
					reject(new Error("IndexedDB completed without an artifact winner."));
					return;
				}
				resolve(winner);
			};
			transaction.onerror = () =>
				reject(
					operationError ??
						transaction.error ??
						addRequest.error ??
						new Error("Unable to persist the projection artifact."),
				);
			transaction.onabort = () =>
				reject(
					operationError ??
						transaction.error ??
						new Error("Projection artifact persistence was aborted."),
				);
		});
	}

	private async prune(database: IDBDatabase): Promise<void> {
		const transaction = database.transaction(
			PROJECTION_ARTIFACT_STORE_NAME,
			"readwrite",
		);
		const completion = transactionComplete(transaction);
		const store = transaction.objectStore(PROJECTION_ARTIFACT_STORE_NAME);
		const index = store.index(CREATED_AT_INDEX);
		const countRequest = store.count();

		countRequest.onsuccess = () => {
			let remaining = countRequest.result - this.maxEntries;
			if (remaining <= 0) return;
			const cursorRequest = index.openCursor();
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (cursor === null || remaining <= 0) return;
				cursor.delete();
				remaining -= 1;
				cursor.continue();
			};
		};

		await completion;
	}
}
