import { create } from "zustand";
import {
	type AdapterReport,
	ApiHttpError,
	type ApiRequestOptions,
	backendToDisplayPlan,
	displayPlanToBackendDocument,
	type FinancialModelDocument,
	type FinancialModelResponse,
	type IncomeDataSnapshot,
	type PlanConversion,
	type PlanPresentation,
	READ_ONLY_IMPORT_MESSAGE,
	type ServerStatus,
} from "../api/index.ts";
import { changesBetween, type Plan, validatePlan } from "../domain/model.ts";
import {
	loadRemoteState,
	persistRemoteState,
	type RemoteLocalState,
	readRemoteStateRaw,
	serverDocumentFingerprint,
} from "./remoteStorage.ts";
import type { Snapshot, StorageError } from "./storage.ts";

export interface RemoteApiClient {
	getStatus(options?: ApiRequestOptions): Promise<Error | ServerStatus>;
	getModel(
		options?: ApiRequestOptions,
	): Promise<Error | FinancialModelResponse>;
	getIncomeData(
		options?: ApiRequestOptions,
	): Promise<Error | IncomeDataSnapshot>;
	putModel(
		document: FinancialModelDocument,
		options?: ApiRequestOptions,
	): Promise<Error | FinancialModelResponse>;
}

export interface RemoteWorkspace {
	version: 1;
	saved: Plan;
	draft: Plan | null;
	baseFingerprint: string | null;
	baseRevision: string | null;
	draftStale: boolean;
	snapshot: Snapshot | null;
}

export interface UseRemoteWorkspaceOptions {
	client?: RemoteApiClient;
	authToken?: string;
}

export interface RemoteWorkspaceState {
	workspace: RemoteWorkspace | null;
	plan: Plan | null;
	status: ServerStatus | null;
	serverDocument: FinancialModelDocument | null;
	serverRevision: string | null;
	draftDocument: FinancialModelDocument | null;
	recoveryDraft: Plan | null;
	incomeData: IncomeDataSnapshot | null;
	adapterReport: AdapterReport | null;
	savedPresentation: PlanPresentation | null;
	draftPresentation: PlanPresentation | null;
	loading: boolean;
	error: string | null;
	notice: string;
	volatile: boolean;
	stale: boolean;
	draftStale: boolean;
	storageConflict: boolean;
	readOnly: boolean;
	authRequired: boolean;
	updatePlan: (next: Plan) => boolean;
	save: () => Promise<boolean>;
	discard: () => boolean;
	reloadDraft: () => Promise<boolean>;
	replace: (next: Plan) => boolean;
	capture: (snapshot: Snapshot) => void;
	importServerDocument: (document: FinancialModelDocument) => Promise<boolean>;
	retry: () => Promise<void>;
	dismissNotice: () => void;
}

function messageFor(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}

function statusFor(error: unknown): number | null {
	if (error instanceof ApiHttpError) return error.status;
	if (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof error.status === "number"
	)
		return error.status;
	return null;
}

function markApiFailure(
	setError: (value: string | null) => void,
	setAuthRequired: (value: boolean) => void,
	setWriteBlocked: (value: boolean) => void,
	error: unknown,
	fallback: string,
): string {
	const message = messageFor(error, fallback);
	const status = statusFor(error);
	if (status === 401) setAuthRequired(true);
	if (status === 403) setWriteBlocked(true);
	setError(message);
	return message;
}

type ReverseConversion = ReturnType<typeof displayPlanToBackendDocument>;

function conversionOrError(
	plan: Plan,
	sourceDocument: FinancialModelDocument | null,
	presentation: PlanPresentation | null,
): ReverseConversion | Error {
	try {
		return displayPlanToBackendDocument(plan, {
			sourceDocument,
			presentation,
		});
	} catch (cause) {
		return new Error(
			messageFor(
				cause,
				"The display plan could not be converted to a server model.",
			),
		);
	}
}

function conversionLossError(
	conversion: ReverseConversion,
	prefix: string,
): string {
	const firstLoss = conversion.report.losses[0];
	if (!firstLoss)
		return `${prefix} The server conversion has no supported representation.`;
	return `${prefix}: ${firstLoss.path ?? firstLoss.field} — ${firstLoss.message}`;
}

const staleDraftMessage =
	"This browser draft is stale because the authoritative server model changed after the draft was created. It remains available for export, but saving and editing are blocked. Discard the draft and load the latest server model before continuing.";
const missingIdentityDraftMessage =
	"This stale browser draft has no recorded server identity, so it cannot be checked safely against the current model. It remains available for export, but saving and editing are blocked until it is discarded or explicitly recreated.";

function localStateFor(
	workspace: RemoteWorkspace,
	draftPresentation: PlanPresentation | null,
): RemoteLocalState {
	return {
		version: 1,
		draft: workspace.draft,
		draftPresentation: workspace.draft ? draftPresentation : null,
		baseFingerprint: workspace.draft ? workspace.baseFingerprint : null,
		baseRevision: workspace.draft ? workspace.baseRevision : null,
		snapshot: workspace.snapshot,
	};
}

function emptyPresentation(): PlanPresentation {
	return { accounts: {}, movements: {} };
}

/**
 * The saved presentation tracks the plan's own metadata, so a renamed plan
 * keeps its new name. The draft presentation deliberately does not: the draft
 * converts against the server document, which still carries the saved name.
 */
function savedPresentationFor(
	plan: Plan,
	presentation: PlanPresentation | null,
): PlanPresentation {
	return {
		...(presentation ?? emptyPresentation()),
		name: plan.name,
		origin: plan.origin,
		updatedAt: plan.updatedAt,
		revision: plan.revision,
		assumptions: plan.assumptions,
	};
}

function draftPresentationFor(
	presentation: PlanPresentation | null,
): PlanPresentation {
	return { ...(presentation ?? emptyPresentation()) };
}

function planHasChanges(saved: Plan, next: Plan): boolean {
	return (
		changesBetween({ saved, current: next }).length > 0 ||
		saved.schemaVersion !== next.schemaVersion ||
		saved.origin !== next.origin ||
		saved.updatedAt !== next.updatedAt ||
		saved.revision !== next.revision ||
		saved.readOnly !== next.readOnly
	);
}

/**
 * Non-reactive engine: controllers, epochs, and in-flight promises that the
 * hook previously held in refs. Mutated directly without notifying, exactly
 * like refs — no render follows an engine write.
 */
interface WorkspaceEngine {
	client: RemoteApiClient | null;
	authToken: string;
	mounted: boolean;
	hydrationController: AbortController | null;
	saveController: AbortController | null;
	saving: boolean;
	expectedRaw: string | null | undefined;
	serverFingerprint: string | null;
	volatileState: RemoteLocalState | null;
	workspaceEpoch: number;
	pendingHydrate: boolean;
	activeSaveToken: symbol | null;
	hydrating: boolean;
	hydrationPromise: Promise<void> | null;
	pendingHydrationError: string | null;
}

function freshEngine(): WorkspaceEngine {
	return {
		client: null,
		authToken: "",
		mounted: false,
		hydrationController: null,
		saveController: null,
		saving: false,
		expectedRaw: undefined,
		serverFingerprint: null,
		volatileState: null,
		workspaceEpoch: 0,
		pendingHydrate: false,
		activeSaveToken: null,
		hydrating: false,
		hydrationPromise: null,
		pendingHydrationError: null,
	};
}

interface WorkspaceData {
	workspace: RemoteWorkspace | null;
	status: ServerStatus | null;
	serverDocument: FinancialModelDocument | null;
	serverRevision: string | null;
	draftDocument: FinancialModelDocument | null;
	recoveryDraft: Plan | null;
	incomeData: IncomeDataSnapshot | null;
	adapterReport: AdapterReport | null;
	savedPresentation: PlanPresentation | null;
	draftPresentation: PlanPresentation | null;
	loading: boolean;
	error: string | null;
	notice: string;
	volatile: boolean;
	authRequiredState: boolean;
	writeBlocked: boolean;
}

function initialData(): WorkspaceData {
	return {
		workspace: null,
		status: null,
		serverDocument: null,
		serverRevision: null,
		draftDocument: null,
		recoveryDraft: null,
		incomeData: null,
		adapterReport: null,
		savedPresentation: null,
		draftPresentation: null,
		loading: true,
		error: null,
		notice: "",
		volatile: false,
		authRequiredState: false,
		writeBlocked: false,
	};
}

interface WorkspaceActions {
	bindEngine: (client: RemoteApiClient | null, authToken: string) => void;
	bootWorkspace: () => void;
	shutdownWorkspace: () => void;
	preserveQueuedError: (message: string) => void;
	reportStorageError: (storageError: StorageError) => void;
	writeLocalState: (
		next: RemoteLocalState,
		fallback?: RemoteLocalState,
	) => boolean;
	hydrate: (options?: { deferDuringSave?: boolean }) => Promise<void>;
	updatePlan: (next: Plan) => boolean;
	save: () => Promise<boolean>;
	importServerDocument: (document: FinancialModelDocument) => Promise<boolean>;
	discard: () => boolean;
	reloadDraft: () => Promise<boolean>;
	replace: (next: Plan) => boolean;
	capture: (snapshot: Snapshot) => void;
	retry: () => Promise<void>;
	dismissNotice: () => void;
}

export const useWorkspaceStore = create<
	WorkspaceData & { engine: WorkspaceEngine } & WorkspaceActions
>()((set, get) => ({
	...initialData(),
	engine: freshEngine(),

	bindEngine: (client, authToken) => {
		get().engine.client = client;
		get().engine.authToken = authToken;
	},

	bootWorkspace: () => {
		get().engine.mounted = true;
		void get().hydrate();
	},

	shutdownWorkspace: () => {
		// The in-flight load is deliberately not aborted here. React's
		// development double-mount remounts immediately, and aborting
		// would cancel the only attempt while the remount reuses the same
		// in-flight promise, leaving the app loading forever.
		// Superseded loads are aborted by hydrate() itself; the mounted
		// flag keeps a completed load from updating state.
		get().engine.mounted = false;
		get().engine.saveController?.abort();
	},

	preserveQueuedError: (message) => {
		get().engine.pendingHydrationError = message;
	},

	reportStorageError: (storageError) => {
		set({ error: storageError.message, volatile: true });
	},

	writeLocalState: (next, fallback = next): boolean => {
		const { engine } = get();
		const result = persistRemoteState(next, engine.expectedRaw);
		if (result) {
			engine.volatileState = fallback;
			get().reportStorageError(result);
			return false;
		}
		engine.expectedRaw = JSON.stringify(next);
		engine.volatileState = null;
		set({ volatile: false });
		return true;
	},

	hydrate: async (options?: { deferDuringSave?: boolean }) => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return;
		if (engine.saving && options?.deferDuringSave !== false) {
			engine.pendingHydrate = true;
			return;
		}
		if (engine.hydrating) return engine.hydrationPromise ?? Promise.resolve();
		engine.hydrationController?.abort();
		const controller = new AbortController();
		engine.hydrationController = controller;
		let resolveHydration!: () => void;
		const completion = new Promise<void>((resolve) => {
			resolveHydration = resolve;
		});
		engine.hydrationPromise = completion;
		let timedOut = false;
		let rejectHydration!: (reason?: unknown) => void;
		const timeoutPromise = new Promise<never>((_, reject) => {
			rejectHydration = reject;
		});
		const hydrationTimer = setTimeout(() => {
			timedOut = true;
			controller.abort();
			rejectHydration(new Error("The server workspace load timed out."));
		}, 30_000);
		engine.workspaceEpoch += 1;
		const restoreError = engine.pendingHydrationError;
		engine.pendingHydrationError = null;
		engine.hydrating = true;
		set({ loading: true, error: restoreError });
		const finishHydration = () => {
			clearTimeout(hydrationTimer);
			if (get().engine.hydrationPromise === completion)
				get().engine.hydrationPromise = null;
			get().engine.hydrating = false;
			resolveHydration();
		};
		const raw = readRemoteStateRaw();
		const stored = loadRemoteState();
		const storageReadError = raw instanceof Error || stored instanceof Error;
		if (raw instanceof Error) get().reportStorageError(raw);
		if (stored instanceof Error) get().reportStorageError(stored);
		const storedState = stored instanceof Error ? null : stored;
		const volatileState = get().engine.volatileState;
		const inMemoryState = get().workspace
			? localStateFor(get().workspace!, get().draftPresentation)
			: null;
		const localState = volatileState ?? storedState ?? inMemoryState;
		set({ recoveryDraft: localState?.draft ?? null });
		get().engine.expectedRaw = raw instanceof Error ? undefined : raw;
		const clearUnavailableWorkspace = () => {
			const inner = get().engine;
			inner.workspaceEpoch += 1;
			inner.saveController?.abort();
			inner.serverFingerprint = null;
			set({
				workspace: null,
				serverDocument: null,
				serverRevision: null,
				status: null,
			});
		};

		let responses: [
			Error | ServerStatus,
			Error | FinancialModelResponse,
			Error | IncomeDataSnapshot,
		];
		try {
			const responsePromise = Promise.all([
				api.getStatus({ signal: controller.signal }),
				api.getModel({ signal: controller.signal }),
				api.getIncomeData({ signal: controller.signal }),
			]);
			responses = (await Promise.race([responsePromise, timeoutPromise])) as [
				Error | ServerStatus,
				Error | FinancialModelResponse,
				Error | IncomeDataSnapshot,
			];
		} catch (cause) {
			if (get().engine.mounted && (!controller.signal.aborted || timedOut)) {
				clearUnavailableWorkspace();
				markApiFailure(
					(value) => set({ error: value }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					cause,
					timedOut
						? "The server workspace load timed out. Retry the connection."
						: "The server workspace could not be loaded. Retry the connection.",
				);
				set({ loading: false });
			}
			finishHydration();
			return;
		}
		const [statusResult, modelResult, incomeResult] = responses;
		if (
			!get().engine.mounted ||
			controller.signal.aborted ||
			get().engine.hydrationController !== controller
		) {
			finishHydration();
			return;
		}
		if (statusResult instanceof Error) {
			clearUnavailableWorkspace();
			markApiFailure(
				(value) => set({ error: value }),
				(value) => set({ authRequiredState: value }),
				(value) => set({ writeBlocked: value }),
				statusResult,
				"The server status could not be loaded. Retry the connection.",
			);
			set({ loading: false });
			finishHydration();
			return;
		}
		if (modelResult instanceof Error) {
			clearUnavailableWorkspace();
			markApiFailure(
				(value) => set({ error: value }),
				(value) => set({ authRequiredState: value }),
				(value) => set({ writeBlocked: value }),
				modelResult,
				"The server financial model could not be loaded. Retry the connection.",
			);
			set({ loading: false });
			finishHydration();
			return;
		}
		const incomeError =
			incomeResult instanceof Error
				? messageFor(
						incomeResult,
						"Income data could not be loaded. The model remains available.",
					)
				: null;
		if (incomeResult instanceof Error) {
			set({ incomeData: null, error: incomeError });
		} else {
			set({ incomeData: incomeResult });
		}
		set({
			status: statusResult,
			authRequiredState: statusResult.authEnabled,
			writeBlocked: false,
		});
		const model = modelResult.document;
		if (!model) {
			get().engine.serverFingerprint = null;
			set({
				workspace: null,
				serverDocument: null,
				serverRevision: null,
				recoveryDraft: localState?.draft ?? null,
				error:
					"The server has no financial model to display. Import and review a model before continuing. Any browser draft remains available for export.",
				loading: false,
			});
			finishHydration();
			return;
		}
		const fingerprint = serverDocumentFingerprint(model);
		get().engine.serverFingerprint = fingerprint;
		set({
			serverDocument: model,
			serverRevision: modelResult.revision ?? null,
		});

		let conversion: PlanConversion;
		try {
			conversion = backendToDisplayPlan({
				document: model,
				status: statusResult,
			});
		} catch (cause) {
			clearUnavailableWorkspace();
			set({
				error: messageFor(
					cause,
					"The server model could not be converted for display.",
				),
				loading: false,
			});
			finishHydration();
			return;
		}
		const savedPlan = conversion.plan;
		const storedDraft = localState?.draft ?? null;
		const storedBaseFingerprint = localState?.baseFingerprint ?? null;
		const storedBaseRevision = localState?.baseRevision ?? null;
		const identityMissing = Boolean(
			storedDraft &&
				(!storedBaseFingerprint ||
					!storedBaseRevision ||
					!modelResult.revision),
		);
		const baseFingerprint = storedDraft ? storedBaseFingerprint : null;
		const baseRevision = storedDraft ? storedBaseRevision : null;
		const fingerprintChanged = Boolean(
			storedDraft &&
				storedBaseFingerprint &&
				storedBaseFingerprint !== fingerprint,
		);
		const revisionChanged = Boolean(
			storedDraft &&
				storedBaseRevision &&
				modelResult.revision &&
				storedBaseRevision !== modelResult.revision,
		);
		const draftStale = identityMissing || fingerprintChanged || revisionChanged;
		const draftPresentation = storedDraft
			? draftPresentationFor(
					localState?.draftPresentation ?? conversion.presentation,
				)
			: null;
		const convertedDraft = storedDraft
			? conversionOrError(storedDraft, model, draftPresentation)
			: null;
		const convertedDraftDocument =
			convertedDraft instanceof Error || convertedDraft === null
				? null
				: convertedDraft.document;
		const nextWorkspace: RemoteWorkspace = {
			version: 1,
			saved: savedPlan,
			draft: storedDraft,
			baseFingerprint,
			baseRevision,
			draftStale,
			snapshot: localState?.snapshot ?? null,
		};
		set({
			recoveryDraft: null,
			workspace: nextWorkspace,
			status: statusResult,
			serverDocument: model,
			draftDocument: convertedDraftDocument,
			adapterReport: conversion.report,
			savedPresentation: conversion.presentation,
			draftPresentation,
			authRequiredState: statusResult.authEnabled,
			writeBlocked: false,
		});
		if (draftStale) set({ volatile: true });

		const shouldRetryStorage = Boolean(
			volatileState ||
				(!storedState && inMemoryState) ||
				(storedDraft && storedBaseFingerprint === null),
		);
		const local = localStateFor(nextWorkspace, draftPresentation);
		const storageWriteFailed =
			shouldRetryStorage && !get().writeLocalState(local, local);
		if (draftStale) {
			const message = identityMissing
				? missingIdentityDraftMessage
				: staleDraftMessage;
			const conversionMessage =
				convertedDraft instanceof Error
					? convertedDraft.message
					: convertedDraft?.report.hasLosses
						? conversionLossError(
								convertedDraft,
								"The stored draft contains unsupported changes",
							)
						: "";
			set({ error: [message, conversionMessage].filter(Boolean).join(" ") });
		} else if (convertedDraft instanceof Error)
			set({ error: convertedDraft.message });
		else if (
			!incomeError &&
			!storageWriteFailed &&
			(!storageReadError || shouldRetryStorage)
		)
			set({ error: restoreError });
		set({ loading: false });
		finishHydration();
	},

	updatePlan: (next: Plan): boolean => {
		const { engine } = get();
		if (engine.saving) {
			set({
				error:
					"Wait for the current server save to finish before editing the plan.",
			});
			return false;
		}
		if (engine.hydrating) {
			set({
				error:
					"Wait for the current server load to finish before editing the plan.",
			});
			return false;
		}
		if (!get().serverRevision) {
			set({
				error:
					"The server did not provide a model content identity. Editing and saving are blocked until the current model supports revisions.",
			});
			return false;
		}
		const current = get().workspace;
		if (!current) {
			set({ error: "Load the server workspace before editing it." });
			return false;
		}
		if (current.draftStale) {
			set({ error: staleDraftMessage });
			return false;
		}
		const validated = validatePlan(next);
		if (validated instanceof Error) {
			set({ error: validated.message });
			return false;
		}
		const draft = planHasChanges(current.saved, validated) ? validated : null;
		const conversionPresentation =
			get().draftPresentation ?? get().savedPresentation;
		const conversion = draft
			? conversionOrError(
					validated,
					get().serverDocument,
					conversionPresentation,
				)
			: null;
		if (conversion instanceof Error) {
			set({ error: conversion.message });
			return false;
		}
		if (conversion?.report.hasLosses) {
			set({
				error: conversionLossError(
					conversion,
					"This change cannot be saved to the server",
				),
			});
			return false;
		}
		const nextDraftPresentation = draft
			? draftPresentationFor(conversionPresentation)
			: null;
		const document = conversion?.document ?? null;
		const nextWorkspace = {
			...current,
			draft,
			baseFingerprint: draft
				? (current.baseFingerprint ?? get().engine.serverFingerprint)
				: null,
			baseRevision: draft
				? (current.baseRevision ?? get().serverRevision)
				: null,
			draftStale: false,
		};
		set({
			workspace: nextWorkspace,
			draftPresentation: nextDraftPresentation,
			draftDocument: document,
		});
		const nextLocal = localStateFor(nextWorkspace, nextDraftPresentation);
		const persisted = get().writeLocalState(nextLocal, nextLocal);
		set({ notice: "Unsaved changes updated. Saved plan unchanged." });
		if (persisted) set({ error: null });
		return true;
	},

	save: async (): Promise<boolean> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return false;
		const authToken = engine.authToken;
		const current = get().workspace;
		if (!current?.draft) {
			set({ error: "There are no unsaved changes to save." });
			return false;
		}
		if (current.draftStale) {
			set({ error: staleDraftMessage });
			return false;
		}
		if (!current.baseRevision || !get().serverRevision) {
			set({
				error:
					"The server did not provide a model content identity. Saving is blocked until the current server model is reloaded with revision support.",
			});
			return false;
		}
		const conversion = conversionOrError(
			current.draft,
			get().serverDocument,
			get().draftPresentation ?? get().savedPresentation,
		);
		if (conversion instanceof Error) {
			set({
				error: `${conversion.message} The temporary plan remains available locally.`,
			});
			return false;
		}
		if (conversion.report.hasLosses) {
			set({
				error: `${conversionLossError(conversion, "Unsaved changes cannot be saved to the server")}. It remains available locally.`,
			});
			return false;
		}
		if (get().status?.readOnly || get().writeBlocked) {
			set({
				error:
					"The server is read-only. The temporary plan remains available for export.",
			});
			return false;
		}
		if (engine.hydrating) {
			set({
				error: "Wait for the current server load to finish before saving.",
			});
			return false;
		}
		if (engine.saving) return false;
		const operationEpoch = engine.workspaceEpoch;
		const saveToken = Symbol();
		engine.activeSaveToken = saveToken;
		engine.saving = true;
		engine.saveController?.abort();
		const controller = new AbortController();
		engine.saveController = controller;
		set({ loading: true, error: null });
		try {
			const document = conversion.document;
			const putResult = await api.putModel(document, {
				authToken,
				signal: controller.signal,
				ifMatch: current.baseRevision ?? undefined,
			});
			if (
				!get().engine.mounted ||
				controller.signal.aborted ||
				get().engine.workspaceEpoch !== operationEpoch
			)
				return false;
			if (putResult instanceof Error) {
				if (statusFor(putResult) === 412) {
					const conflicted = { ...current, draftStale: true };
					set({ workspace: conflicted });
					get().writeLocalState(
						localStateFor(conflicted, get().draftPresentation),
						localStateFor(current, get().draftPresentation),
					);
					const message =
						"The server model changed after this draft was created. The draft remains available locally, but saving is blocked until it is discarded or reloaded.";
					set({ error: message });
					get().preserveQueuedError(message);
					return false;
				}
				const message = markApiFailure(
					(value) => set({ error: value }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					putResult,
					"The temporary plan could not be saved to the server. It remains available locally.",
				);
				get().preserveQueuedError(message);
				return false;
			}
			const validationErrors = putResult.issues.filter(
				(issue) => issue.severity === "error",
			);
			if (validationErrors.length) {
				const details = validationErrors
					.map((issue) => issue.message)
					.filter(Boolean)
					.join(" ");
				const message = `The temporary plan could not be saved to the server${details ? `: ${details}` : "."} It remains available locally.`;
				set({ error: message });
				get().preserveQueuedError(message);
				return false;
			}
			const authoritative = await api.getModel({ signal: controller.signal });
			if (
				!get().engine.mounted ||
				controller.signal.aborted ||
				get().engine.workspaceEpoch !== operationEpoch
			)
				return false;
			if (authoritative instanceof Error) {
				const message = markApiFailure(
					(value) => set({ error: value }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					authoritative,
					"The save completed, but the authoritative model could not be reloaded. Your temporary plan remains available locally.",
				);
				get().preserveQueuedError(message);
				return false;
			}
			if (!authoritative.document) {
				const message =
					"The save completed, but the server returned no authoritative model. Your temporary plan remains available locally.";
				set({ error: message });
				get().preserveQueuedError(message);
				return false;
			}
			let authoritativeConversion: PlanConversion;
			try {
				authoritativeConversion = backendToDisplayPlan({
					document: authoritative.document,
					status: get().status ?? { readOnly: false, authEnabled: false },
					presentation: get().draftPresentation ?? get().savedPresentation,
				});
			} catch (cause) {
				const message = messageFor(
					cause,
					"The authoritative model was saved but could not be converted for display. Your temporary plan remains available locally.",
				);
				set({ error: message });
				get().preserveQueuedError(message);
				return false;
			}
			const authoritativeFingerprint = serverDocumentFingerprint(
				authoritative.document,
			);
			const nextWorkspace: RemoteWorkspace = {
				version: 1,
				saved: authoritativeConversion.plan,
				draft: null,
				baseFingerprint: null,
				baseRevision: null,
				draftStale: false,
				snapshot: current.snapshot,
			};
			const nextLocal: RemoteLocalState = {
				version: 1,
				draft: null,
				draftPresentation: null,
				baseFingerprint: null,
				baseRevision: null,
				snapshot: current.snapshot,
			};
			const fallbackLocal = localStateFor(
				current,
				get().draftPresentation ?? get().savedPresentation,
			);
			const persisted = get().writeLocalState(nextLocal, fallbackLocal);
			const retainedPresentation = persisted
				? null
				: fallbackLocal.draftPresentation;
			const retainedDocument = persisted ? null : get().draftDocument;
			const retainedWorkspace = persisted
				? nextWorkspace
				: {
						...nextWorkspace,
						draft: current.draft,
						baseFingerprint: current.baseFingerprint,
						baseRevision: current.baseRevision,
						draftStale: Boolean(
							(current.baseFingerprint &&
								current.baseFingerprint !== authoritativeFingerprint) ||
								(current.baseRevision &&
									authoritative.revision &&
									current.baseRevision !== authoritative.revision),
						),
					};
			set({
				workspace: retainedWorkspace,
				savedPresentation: authoritativeConversion.presentation,
				draftPresentation: retainedPresentation,
				draftDocument: retainedDocument,
				serverDocument: authoritative.document,
				serverRevision: authoritative.revision ?? null,
				adapterReport: authoritativeConversion.report,
				writeBlocked: false,
				notice: "Plan saved on the server.",
			});
			get().engine.serverFingerprint = authoritativeFingerprint;
			if (!persisted)
				set({
					error:
						"The server model was saved, but browser draft storage could not be updated. The temporary plan remains available locally.",
				});
			return persisted;
		} catch (cause) {
			if (
				!controller.signal.aborted &&
				get().engine.workspaceEpoch === operationEpoch
			) {
				const message = markApiFailure(
					(value) => set({ error: value }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					cause,
					"The server save failed. The temporary plan remains available locally.",
				);
				get().preserveQueuedError(message);
			}
			return false;
		} finally {
			if (get().engine.activeSaveToken === saveToken) {
				get().engine.activeSaveToken = null;
				get().engine.saving = false;
				if (
					get().engine.mounted &&
					get().engine.workspaceEpoch === operationEpoch
				)
					set({ loading: false });
				if (get().engine.pendingHydrate && get().engine.mounted) {
					get().engine.pendingHydrate = false;
					await get().hydrate();
				}
			}
		}
	},

	importServerDocument: async (
		document: FinancialModelDocument,
	): Promise<boolean> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return false;
		const authToken = engine.authToken;
		if (get().workspace) {
			set({
				error:
					"A server model is already loaded. Use the reviewed import action in Configs.",
			});
			return false;
		}
		if (get().status?.readOnly || get().writeBlocked) {
			set({ error: READ_ONLY_IMPORT_MESSAGE });
			return false;
		}
		if (engine.hydrating) {
			set({
				error: "Wait for the current server load to finish before importing.",
			});
			return false;
		}
		if (engine.saving) return false;
		const saveToken = Symbol();
		engine.activeSaveToken = saveToken;
		engine.saving = true;
		engine.saveController?.abort();
		const controller = new AbortController();
		engine.saveController = controller;
		set({ loading: true, error: null });
		try {
			const result = await api.putModel(document, {
				authToken,
				signal: controller.signal,
				ifMatch: "*",
			});
			if (!get().engine.mounted || controller.signal.aborted) return false;
			if (result instanceof Error) {
				if (statusFor(result) === 412) {
					await get().hydrate({ deferDuringSave: false });
					if (!get().workspace) return false;
					const message =
						"A server model was created while this import was being reviewed. The latest server model has been loaded; review it before importing again.";
					set({ error: message });
					get().preserveQueuedError(message);
					return false;
				}
				const message = markApiFailure(
					(value) => set({ error: value }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					result,
					"The selected model could not be imported. The server has no active model.",
				);
				get().preserveQueuedError(message);
				return false;
			}
			set({
				notice: "Server model imported. Loading the authoritative model.",
			});
			await get().hydrate({ deferDuringSave: false });
			return get().engine.mounted && Boolean(get().workspace);
		} catch (cause) {
			if (!controller.signal.aborted) {
				const message = markApiFailure(
					(value) => set({ error: value }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					cause,
					"The selected model could not be imported. The server has no active model.",
				);
				get().preserveQueuedError(message);
			}
			return false;
		} finally {
			if (get().engine.activeSaveToken === saveToken) {
				get().engine.activeSaveToken = null;
				get().engine.saving = false;
				if (get().engine.mounted) set({ loading: false });
				if (get().engine.pendingHydrate && get().engine.mounted) {
					get().engine.pendingHydrate = false;
					await get().hydrate();
				}
			}
		}
	},

	discard: (): boolean => {
		const { engine } = get();
		if (engine.hydrating || engine.saving) {
			set({
				error:
					"Wait for the current server operation to finish before discarding changes.",
			});
			return false;
		}
		const current = get().workspace;
		if (!current) return false;
		if (current.draftStale) {
			set({ error: staleDraftMessage });
			return false;
		}
		const nextWorkspace: RemoteWorkspace = {
			...current,
			draft: null,
			baseFingerprint: null,
			baseRevision: null,
			draftStale: false,
		};
		const nextLocal = localStateFor(nextWorkspace, null);
		const fallbackLocal = localStateFor(current, get().draftPresentation);
		const persisted = get().writeLocalState(nextLocal, fallbackLocal);
		if (!persisted) return false;
		set({
			workspace: nextWorkspace,
			draftPresentation: null,
			draftDocument: null,
			notice: "Unsaved changes discarded. Saved server plan restored.",
			error: null,
		});
		return true;
	},

	reloadDraft: async (): Promise<boolean> => {
		const { engine } = get();
		if (engine.hydrating || engine.saving) {
			set({
				error:
					"Wait for the current server operation to finish before reloading the draft.",
			});
			return false;
		}
		const current = get().workspace;
		if (!current) return false;
		const nextWorkspace: RemoteWorkspace = {
			...current,
			draft: null,
			baseFingerprint: null,
			baseRevision: null,
			draftStale: false,
		};
		const nextLocal = localStateFor(nextWorkspace, null);
		const fallbackLocal = localStateFor(current, get().draftPresentation);
		const persisted = get().writeLocalState(nextLocal, fallbackLocal);
		if (!persisted) return false;
		set({
			workspace: nextWorkspace,
			draftDocument: null,
			draftPresentation: null,
			error: null,
			notice: "Stale draft discarded. Loading the latest server model.",
		});
		await get().hydrate();
		return get().engine.mounted && get().workspace !== null;
	},

	replace: (next: Plan): boolean => {
		const { engine } = get();
		if (engine.hydrating || engine.saving) {
			set({
				error:
					"Wait for the current server operation to finish before replacing the plan.",
			});
			return false;
		}
		const current = get().workspace;
		if (!current) {
			set({ error: "Load the server workspace before replacing it." });
			return false;
		}
		if (current.draft) {
			set({
				error:
					"Save or discard the current temporary plan before importing another plan.",
			});
			return false;
		}
		const validated = validatePlan(next);
		if (validated instanceof Error) {
			set({ error: validated.message });
			return false;
		}
		let conversion: ReturnType<typeof displayPlanToBackendDocument>;
		try {
			conversion = displayPlanToBackendDocument(validated, {
				sourceDocument: get().serverDocument,
				presentation: get().savedPresentation,
			});
		} catch (cause) {
			set({
				error: messageFor(
					cause,
					"The imported display plan could not be reviewed for server conversion.",
				),
			});
			return false;
		}
		if (conversion.report.hasLosses) {
			const firstLoss = conversion.report.losses[0];
			set({
				error: `This import needs explicit conversion review before it can replace the server model${firstLoss ? `: ${firstLoss.message}` : "."}`,
			});
			return false;
		}
		const nextWorkspace: RemoteWorkspace = {
			...current,
			draft: validated,
			baseFingerprint: get().engine.serverFingerprint,
			baseRevision: get().serverRevision,
			draftStale: false,
			snapshot: null,
		};
		const draftPresentation = draftPresentationFor(
			savedPresentationFor(validated, get().savedPresentation),
		);
		set({
			workspace: nextWorkspace,
			draftPresentation,
			draftDocument: conversion.document,
		});
		const nextLocal = localStateFor(nextWorkspace, draftPresentation);
		const persisted = get().writeLocalState(nextLocal, nextLocal);
		set({ notice: "Imported plan is ready for review and save." });
		if (persisted) set({ error: null });
		return true;
	},

	capture: (snapshot: Snapshot) => {
		const { engine } = get();
		if (engine.hydrating || engine.saving) {
			set({
				error:
					"Wait for the current server operation to finish before capturing a comparison.",
			});
			return;
		}
		const current = get().workspace;
		if (!current) return;
		const nextWorkspace = { ...current, snapshot };
		set({ workspace: nextWorkspace });
		const nextLocal = localStateFor(nextWorkspace, get().draftPresentation);
		const persisted = get().writeLocalState(nextLocal, nextLocal);
		set({ notice: "Comparison snapshot captured." });
		if (persisted) set({ error: null });
	},

	retry: async () => {
		const { engine } = get();
		if (engine.hydrating) {
			await engine.hydrationPromise;
			return;
		}
		if (engine.saving) {
			engine.pendingHydrate = true;
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			if (!engine.saving) {
				if (engine.hydrating) await engine.hydrationPromise;
				return;
			}
			engine.workspaceEpoch += 1;
			engine.activeSaveToken = null;
			engine.saveController?.abort();
			engine.saveController = null;
			engine.saving = false;
			engine.pendingHydrate = false;
			await get().hydrate({ deferDuringSave: false });
			return;
		}
		await get().hydrate();
	},

	dismissNotice: () => set({ notice: "" }),
}));

/** Test hook: restores a pristine engine and data between cases. */
export function resetWorkspaceStore(): void {
	useWorkspaceStore.setState({ ...initialData(), engine: freshEngine() });
}
