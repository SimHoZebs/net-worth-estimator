import { create } from "zustand";
import { getResourceScope, type ResourceScope } from "../auth/resourceScope.ts";
import {
	type AdapterReport,
	type AmountPreset,
	type AmountPresetWriteResponse,
	ApiHttpError,
	type ApiRequestOptions,
	backendToDisplayPlan,
	displayPlanToBackendDocument,
	type FinancialModelDocument,
	type FinancialModelResponse,
	type PlanConversion,
	type PlanPresentation,
	READ_ONLY_IMPORT_MESSAGE,
	refreshDisplayPlanAccess,
	type ServerStatus,
} from "../api/index.ts";
import {
	applyRowOperations,
	diffFinancialModelDocuments,
	type RowWriter,
} from "../api/rowSync.ts";
import { changesBetween, type Plan, validatePlan } from "../domain/model.ts";
import {
	loadRemoteState,
	persistRemoteState,
	type RemoteLocalState,
	readRemoteStateRaw,
	serverDocumentFingerprint,
} from "./remoteStorage.ts";
import {
	dismissKey,
	notifyError,
	notifySuccess,
	type ToastAction,
} from "./notifications.ts";
import type { StorageError } from "./storage.ts";

export interface RemoteApiClient extends RowWriter {
	getStatus(options?: ApiRequestOptions): Promise<Error | ServerStatus>;
	getModel(
		options?: ApiRequestOptions,
	): Promise<Error | FinancialModelResponse>;
	listAmountPresets(
		options?: ApiRequestOptions,
	): Promise<Error | { presets: AmountPreset[] }>;
	createAmountPreset(
		preset: AmountPreset,
		options?: ApiRequestOptions,
	): Promise<Error | AmountPresetWriteResponse>;
	updateAmountPreset(
		id: string,
		preset: AmountPreset,
		options?: ApiRequestOptions,
	): Promise<Error | AmountPresetWriteResponse>;
	deleteAmountPreset(
		id: string,
		options?: ApiRequestOptions,
	): Promise<Error | { deletedId: string }>;
	moveAmountPreset(
		id: string,
		beforeId: string | null,
		options?: ApiRequestOptions,
	): Promise<Error | { movedId: string }>;
}

export interface RemoteWorkspace {
	version: 1;
	saved: Plan;
	draft: Plan | null;
	baseFingerprint: string | null;
	baseRevision: string | null;
	draftStale: boolean;
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

/**
 * Derive the server document for a draft on demand instead of storing it.
 * The conversion already runs on every edit (updatePlan loss-check) and save,
 * so the stored copy duplicated that work per write while adding a third plan
 * shape to keep in sync. Derivation runs at most once per draft, server
 * document, or presentation reference change via useMemo at the call site.
 * Mirrors the previously stored values: the converted document when the
 * reverse conversion succeeds (even lossy, as hydrate stored it), null when
 * the conversion throws.
 */
export function deriveDraftDocument(
	draft: Plan | null,
	sourceDocument: FinancialModelDocument | null,
	presentation: PlanPresentation | null,
): FinancialModelDocument | null {
	if (!draft) return null;
	try {
		return displayPlanToBackendDocument(draft, {
			sourceDocument,
			presentation,
		}).document;
	} catch {
		return null;
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
	"This browser draft is stale because the authoritative server model changed after the draft was created. Saving and editing are blocked. Discard the draft and load the latest server model before continuing.";
const missingIdentityDraftMessage =
	"This stale browser draft has no recorded server identity, so it cannot be checked safely against the current model. Saving and editing are blocked until it is discarded or explicitly recreated.";

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
	resourceScope: ResourceScope;
	mounted: boolean;
	hydrationController: AbortController | null;
	saveController: AbortController | null;
	saving: boolean;
	expectedRaw: string | null | undefined;
	serverFingerprint: string | null;
	volatileState: RemoteLocalState | null;
	// Save/hydrate epoch only. Guards save/hydrate races; deterministic and
	// stochastic queries cancel via their own AbortController/signal and
	// TanStack query keys, never via this epoch.
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
		resourceScope: getResourceScope(),
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

export type WorkspaceErrorCode =
	| "stale-draft"
	| "storage-conflict"
	| "missing-model"
	| null;

interface WorkspaceData {
	workspace: RemoteWorkspace | null;
	status: ServerStatus | null;
	serverDocument: FinancialModelDocument | null;
	serverRevision: string | null;
	// Retained for programmatic recovery/debugging; no UI reader after export removal.
	recoveryDraft: Plan | null;
	serverPresets: AmountPreset[] | null;
	presetError: string | null;
	adapterReport: AdapterReport | null;
	savedPresentation: PlanPresentation | null;
	draftPresentation: PlanPresentation | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
	errorCode: WorkspaceErrorCode;
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
		recoveryDraft: null,
		serverPresets: null,
		presetError: null,
		adapterReport: null,
		savedPresentation: null,
		draftPresentation: null,
		loading: true,
		saving: false,
		error: null,
		errorCode: null,
		notice: "",
		volatile: false,
		authRequiredState: false,
		writeBlocked: false,
	};
}

/** Single derived readers so views do not duplicate `draft ?? saved`. */
export function selectPlan(state: WorkspaceData): Plan | null {
	return state.workspace?.draft ?? state.workspace?.saved ?? null;
}

export function selectDraftChangeCount(state: WorkspaceData): number {
	const plan = selectPlan(state);
	if (!state.workspace || !plan) return 0;
	return changesBetween({ saved: state.workspace.saved, current: plan }).length;
}

/** Single edit-gating reader so views do not recompute the status, write-block,
 * and effective-plan flags. Unreachable null-plan differences are preserved:
 * every current reader only renders it when a plan is loaded. */
export function selectIsReadOnly(state: WorkspaceData): boolean {
	return (
		(state.status?.readOnly ?? false) ||
		state.writeBlocked ||
		(selectPlan(state)?.readOnly ?? state.status?.readOnly ?? true)
	);
}

interface WorkspaceActions {
	bindEngine: (client: RemoteApiClient | null) => void;
	bootWorkspace: () => void;
	shutdownWorkspace: () => void;
	preserveQueuedError: (message: string) => void;
	reportStorageError: (storageError: StorageError) => void;
	writeLocalState: (
		next: RemoteLocalState,
		fallback?: RemoteLocalState,
	) => boolean;
	hydrate: (options?: { deferDuringSave?: boolean }) => Promise<void>;
	refreshStatus: () => Promise<void>;
	updatePlan: (next: Plan) => boolean;
	save: () => Promise<boolean>;
	importServerDocument: (document: FinancialModelDocument) => Promise<boolean>;
	discard: () => boolean;
	reloadDraft: () => Promise<boolean>;
	replace: (next: Plan) => boolean;
	retry: () => Promise<void>;
	dismissNotice: () => void;
	refreshPresets: () => Promise<void>;
	createPreset: (preset: AmountPreset) => Promise<boolean>;
	updatePreset: (preset: AmountPreset) => Promise<boolean>;
	deletePreset: (id: string) => Promise<boolean>;
	movePreset: (id: string, beforeId: string | null) => Promise<boolean>;
}

export const useWorkspaceStore = create<
	WorkspaceData & { engine: WorkspaceEngine } & WorkspaceActions
>()((set, get) => ({
	...initialData(),
	engine: freshEngine(),

	bindEngine: (client) => {
		get().engine.client = client;
		get().engine.resourceScope = getResourceScope();
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
		const conflict = storageError.message.includes("changed in another tab");
		set({
			error: storageError.message,
			errorCode: conflict ? "storage-conflict" : null,
			volatile: true,
		});
	},

	writeLocalState: (next, fallback = next): boolean => {
		const { engine } = get();
		const result = persistRemoteState(
			next,
			engine.expectedRaw,
			engine.resourceScope,
		);
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
		set({ loading: true, error: restoreError, errorCode: null });
		const finishHydration = () => {
			clearTimeout(hydrationTimer);
			if (get().engine === engine) {
				if (engine.hydrationPromise === completion)
					engine.hydrationPromise = null;
				engine.hydrating = false;
			}
			resolveHydration();
		};
		const raw = readRemoteStateRaw(engine.resourceScope);
		const stored = loadRemoteState(engine.resourceScope);
		const storageReadError = raw instanceof Error || stored instanceof Error;
		if (raw instanceof Error) get().reportStorageError(raw);
		if (stored instanceof Error) get().reportStorageError(stored);
		const storedState = stored instanceof Error ? null : stored;
		const volatileState = get().engine.volatileState;
		// Saved-only data needs no recovery write. An empty write can invalidate
		// another tab's compare-before-write token during session verification.
		const inMemoryState = get().workspace?.draft
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
				serverPresets: null,
				presetError: null,
				status: null,
			});
		};

		let responses: [
			Error | ServerStatus,
			Error | FinancialModelResponse,
			Error | { presets: AmountPreset[] },
		];
		try {
			const responsePromise = Promise.all([
				api.getStatus({ signal: controller.signal }),
				api.getModel({ signal: controller.signal }),
				api.listAmountPresets({ signal: controller.signal }),
			]);
			responses = (await Promise.race([responsePromise, timeoutPromise])) as [
				Error | ServerStatus,
				Error | FinancialModelResponse,
				Error | { presets: AmountPreset[] },
			];
		} catch (cause) {
			if (
				get().engine === engine &&
				engine.mounted &&
				(!controller.signal.aborted || timedOut)
			) {
				clearUnavailableWorkspace();
				markApiFailure(
					(value) => set({ error: value, errorCode: null }),
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
		const [statusResult, modelResult, presetResult] = responses;
		if (
			get().engine !== engine ||
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
				(value) => set({ error: value, errorCode: null }),
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
				(value) => set({ error: value, errorCode: null }),
				(value) => set({ authRequiredState: value }),
				(value) => set({ writeBlocked: value }),
				modelResult,
				"The server financial model could not be loaded. Retry the connection.",
			);
			set({ loading: false });
			finishHydration();
			return;
		}
		if (presetResult instanceof Error) {
			set({
				serverPresets: null,
				presetError: messageFor(
					presetResult,
					"Saved amount recipes could not be loaded.",
				),
			});
		} else {
			set({ serverPresets: presetResult.presets, presetError: null });
		}
		set({
			status: statusResult,
			authRequiredState: false,
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
					"The server has no financial model to display. Import and review a model before continuing.",
				errorCode: "missing-model",
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
				errorCode: null,
				loading: false,
			});
			finishHydration();
			return;
		}
		const savedPlan = conversion.plan;
		const storedDraftAccess = localState?.draft
			? refreshDisplayPlanAccess(localState.draft, {
					document: model,
					status: statusResult,
					presentation: localState.draftPresentation ?? conversion.presentation,
				})
			: null;
		const storedDraft = storedDraftAccess?.plan ?? null;
		const storedBaseFingerprint = localState?.baseFingerprint ?? null;
		const storedBaseRevision = localState?.baseRevision ?? null;
		const identityMissing = Boolean(
			storedDraft &&
			(!storedBaseFingerprint || !storedBaseRevision || !modelResult.revision),
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
					storedDraftAccess?.presentation ?? conversion.presentation,
				)
			: null;
		const convertedDraft = storedDraft
			? conversionOrError(storedDraft, model, draftPresentation)
			: null;
		const nextWorkspace: RemoteWorkspace = {
			version: 1,
			saved: savedPlan,
			draft: storedDraft,
			baseFingerprint,
			baseRevision,
			draftStale,
		};
		set({
			recoveryDraft: null,
			workspace: nextWorkspace,
			status: statusResult,
			serverDocument: model,
			adapterReport: conversion.report,
			savedPresentation: conversion.presentation,
			draftPresentation,
			authRequiredState: false,
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
			set({
				error: [message, conversionMessage].filter(Boolean).join(" "),
				errorCode: "stale-draft",
			});
		} else if (convertedDraft instanceof Error)
			set({ error: convertedDraft.message, errorCode: null });
		else if (!storageWriteFailed && (!storageReadError || shouldRetryStorage))
			set({ error: restoreError, errorCode: null });
		set({ loading: false });
		finishHydration();
	},

	updatePlan: (next: Plan): boolean => {
		const { engine } = get();
		if (engine.saving) {
			set({
				error:
					"Wait for the current server save to finish before editing the plan.",
				errorCode: null,
			});
			return false;
		}
		if (engine.hydrating) {
			set({
				error:
					"Wait for the current server load to finish before editing the plan.",
				errorCode: null,
			});
			return false;
		}
		const current = get().workspace;
		if (!current) {
			set({
				error: "Load the server workspace before editing it.",
				errorCode: null,
			});
			return false;
		}
		if (current.draftStale) {
			set({ error: staleDraftMessage, errorCode: "stale-draft" });
			return false;
		}
		const validated = validatePlan(next);
		if (validated instanceof Error) {
			set({ error: validated.message, errorCode: null });
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
			set({ error: conversion.message, errorCode: null });
			return false;
		}
		if (conversion?.report.hasLosses) {
			set({
				error: conversionLossError(
					conversion,
					"This change cannot be saved to the server",
				),
				errorCode: null,
			});
			return false;
		}
		const nextDraftPresentation = draft
			? draftPresentationFor(conversionPresentation)
			: null;
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
		});
		const nextLocal = localStateFor(nextWorkspace, nextDraftPresentation);
		const persisted = get().writeLocalState(nextLocal, nextLocal);
		set({ notice: "Unsaved changes updated. Saved plan unchanged." });
		if (persisted) set({ error: null, errorCode: null });
		return true;
	},

	save: async (): Promise<boolean> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return false;
		const current = get().workspace;
		if (!current?.draft) {
			set({ error: "There are no unsaved changes to save.", errorCode: null });
			return false;
		}
		if (current.draftStale) {
			set({ error: staleDraftMessage, errorCode: "stale-draft" });
			return false;
		}
		if (!get().serverDocument && !get().serverRevision) {
			set({
				error:
					"The server model has not loaded yet. Wait for the current server load to finish before saving.",
				errorCode: null,
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
				errorCode: null,
			});
			return false;
		}
		if (conversion.report.hasLosses) {
			set({
				error: `${conversionLossError(conversion, "Unsaved changes cannot be saved to the server")}. It remains available locally.`,
				errorCode: null,
			});
			return false;
		}
		if (get().status?.readOnly || get().writeBlocked) {
			set({
				error: "The server is read-only. The temporary plan remains unsaved.",
				errorCode: null,
			});
			return false;
		}
		if (engine.hydrating) {
			set({
				error: "Wait for the current server load to finish before saving.",
				errorCode: null,
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
		set({ loading: true, saving: true, error: null, errorCode: null });
		try {
			const document = conversion.document;
			const operations = diffFinancialModelDocuments(
				get().serverDocument,
				document,
			);
			const applyResult = await applyRowOperations(api, operations, {
				signal: controller.signal,
			});
			if (
				!get().engine.mounted ||
				controller.signal.aborted ||
				get().engine.workspaceEpoch !== operationEpoch
			)
				return false;
			if (applyResult instanceof Error) {
				const message = markApiFailure(
					(value) => set({ error: value, errorCode: null }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					applyResult,
					"The temporary plan could not be saved to the server. It remains available locally.",
				);
				get().preserveQueuedError(message);
				return false;
			}
			const validationErrors = applyResult.issues.filter(
				(issue) => issue.severity === "error",
			);
			if (validationErrors.length) {
				const details = validationErrors
					.map((issue) => issue.message)
					.filter(Boolean)
					.join(" ");
				const message = `The temporary plan could not be saved to the server${details ? `: ${details}` : "."} It remains available locally.`;
				set({ error: message, errorCode: null });
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
					(value) => set({ error: value, errorCode: null }),
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
				set({ error: message, errorCode: null });
				get().preserveQueuedError(message);
				return false;
			}
			let authoritativeConversion: PlanConversion;
			try {
				authoritativeConversion = backendToDisplayPlan({
					document: authoritative.document,
					status: get().status ?? { readOnly: false },
					presentation: get().draftPresentation ?? get().savedPresentation,
				});
			} catch (cause) {
				const message = messageFor(
					cause,
					"The authoritative model was saved but could not be converted for display. Your temporary plan remains available locally.",
				);
				set({ error: message, errorCode: null });
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
			};
			const nextLocal: RemoteLocalState = {
				version: 1,
				draft: null,
				draftPresentation: null,
				baseFingerprint: null,
				baseRevision: null,
			};
			const fallbackLocal = localStateFor(
				current,
				get().draftPresentation ?? get().savedPresentation,
			);
			const persisted = get().writeLocalState(nextLocal, fallbackLocal);
			const retainedPresentation = persisted
				? null
				: fallbackLocal.draftPresentation;
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
					errorCode: null,
				});
			return persisted;
		} catch (cause) {
			if (
				!controller.signal.aborted &&
				get().engine.workspaceEpoch === operationEpoch
			) {
				const message = markApiFailure(
					(value) => set({ error: value, errorCode: null }),
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
					set({ loading: false, saving: false });
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
		if (get().workspace) {
			set({
				error:
					"A server model is already loaded. Use the reviewed import action in Configs.",
				errorCode: null,
			});
			return false;
		}
		if (get().status?.readOnly || get().writeBlocked) {
			set({ error: READ_ONLY_IMPORT_MESSAGE, errorCode: null });
			return false;
		}
		if (engine.hydrating) {
			set({
				error: "Wait for the current server load to finish before importing.",
				errorCode: null,
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
		set({ loading: true, saving: true, error: null, errorCode: null });
		try {
			const operations = diffFinancialModelDocuments(null, document);
			const result = await applyRowOperations(api, operations, {
				signal: controller.signal,
			});
			if (!get().engine.mounted || controller.signal.aborted) return false;
			if (result instanceof Error) {
				const message = markApiFailure(
					(value) => set({ error: value, errorCode: null }),
					(value) => set({ authRequiredState: value }),
					(value) => set({ writeBlocked: value }),
					result,
					"The selected model could not be imported. The server has no active model.",
				);
				get().preserveQueuedError(message);
				return false;
			}
			if (!result.ok) {
				const details = result.issues
					.filter((issue) => issue.severity === "error")
					.map((issue) => issue.message)
					.filter(Boolean)
					.join(" ");
				const message = `The selected model could not be imported${details ? `: ${details}` : "."}`;
				set({ error: message, errorCode: null });
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
					(value) => set({ error: value, errorCode: null }),
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
				if (get().engine.mounted) set({ loading: false, saving: false });
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
				errorCode: null,
			});
			return false;
		}
		const current = get().workspace;
		if (!current) return false;
		if (current.draftStale) {
			set({ error: staleDraftMessage, errorCode: "stale-draft" });
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
			notice: "Unsaved changes discarded. Saved server plan restored.",
			error: null,
			errorCode: null,
		});
		return true;
	},

	reloadDraft: async (): Promise<boolean> => {
		const { engine } = get();
		if (engine.hydrating || engine.saving) {
			set({
				error:
					"Wait for the current server operation to finish before reloading the draft.",
				errorCode: null,
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
			draftPresentation: null,
			error: null,
			errorCode: null,
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
				errorCode: null,
			});
			return false;
		}
		const current = get().workspace;
		if (!current) {
			set({
				error: "Load the server workspace before replacing it.",
				errorCode: null,
			});
			return false;
		}
		if (current.draft) {
			set({
				error:
					"Save or discard the current temporary plan before importing another plan.",
				errorCode: null,
			});
			return false;
		}
		const validated = validatePlan(next);
		if (validated instanceof Error) {
			set({ error: validated.message, errorCode: null });
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
				errorCode: null,
			});
			return false;
		}
		if (conversion.report.hasLosses) {
			const firstLoss = conversion.report.losses[0];
			set({
				error: `This import needs explicit conversion review before it can replace the server model${firstLoss ? `: ${firstLoss.message}` : "."}`,
				errorCode: null,
			});
			return false;
		}
		const nextWorkspace: RemoteWorkspace = {
			...current,
			draft: validated,
			baseFingerprint: get().engine.serverFingerprint,
			baseRevision: get().serverRevision,
			draftStale: false,
		};
		const draftPresentation = draftPresentationFor(
			savedPresentationFor(validated, get().savedPresentation),
		);
		set({
			workspace: nextWorkspace,
			draftPresentation,
		});
		const nextLocal = localStateFor(nextWorkspace, draftPresentation);
		const persisted = get().writeLocalState(nextLocal, nextLocal);
		set({ notice: "Imported plan is ready for review and save." });
		if (persisted) set({ error: null, errorCode: null });
		return true;
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
			set({ saving: false });
			engine.pendingHydrate = false;
			await get().hydrate({ deferDuringSave: false });
			return;
		}
		await get().hydrate();
	},

	dismissNotice: () => set({ notice: "" }),

	/** Re-reads /v1/status without touching the loaded model. Failures
	 * surface through the shared error state, mirroring hydrate. */
	refreshStatus: async (): Promise<void> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return;
		const result = await api.getStatus();
		if (get().engine !== engine) return;
		if (result instanceof Error) {
			markApiFailure(
				(value) => set({ error: value, errorCode: null }),
				(value) => set({ authRequiredState: value }),
				(value) => set({ writeBlocked: value }),
				result,
				"The server status could not be refreshed. Retry the connection.",
			);
			return;
		}
		const current = get();
		const savedAccess =
			current.workspace && current.serverDocument
				? refreshDisplayPlanAccess(current.workspace.saved, {
						document: current.serverDocument,
						status: result,
						presentation: current.savedPresentation,
					})
				: null;
		const draftAccess =
			current.workspace?.draft && current.serverDocument
				? refreshDisplayPlanAccess(current.workspace.draft, {
						document: current.serverDocument,
						status: result,
						presentation:
							current.draftPresentation ?? current.savedPresentation,
					})
				: null;
		set({
			status: result,
			authRequiredState: false,
			writeBlocked: false,
			...(current.workspace && savedAccess
				? {
						workspace: {
							...current.workspace,
							saved: savedAccess.plan,
							draft: draftAccess?.plan ?? null,
						},
						savedPresentation: savedAccess.presentation,
						draftPresentation: draftAccess?.presentation ?? null,
					}
				: {}),
		});
	},

	refreshPresets: async (): Promise<void> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return;
		const result = await api.listAmountPresets();
		if (get().engine !== engine) return;
		if (result instanceof Error) {
			set({
				serverPresets: null,
				presetError: messageFor(
					result,
					"Saved amount recipes could not be loaded.",
				),
			});
			return;
		}
		set({ serverPresets: result.presets, presetError: null });
	},

	createPreset: async (preset: AmountPreset): Promise<boolean> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return false;
		const result = await api.createAmountPreset(preset);
		if (get().engine !== engine) return false;
		if (result instanceof Error) {
			set({
				presetError: messageFor(result, "The recipe could not be saved."),
			});
			return false;
		}
		if (!result.persisted) {
			const details = result.issues
				.map((issue) => issue.message)
				.filter(Boolean)
				.join(" ");
			set({
				presetError: `The recipe was rejected${details ? `: ${details}` : "."}`,
			});
			return false;
		}
		set({
			serverPresets: [...(get().serverPresets ?? []), result.row],
			presetError: null,
		});
		return true;
	},

	updatePreset: async (preset: AmountPreset): Promise<boolean> => {
		const { engine } = get();
		const api = engine.client;
		if (!api || !preset.id) return false;
		const result = await api.updateAmountPreset(preset.id, preset);
		if (get().engine !== engine) return false;
		if (result instanceof Error) {
			set({
				presetError: messageFor(result, "The recipe could not be saved."),
			});
			return false;
		}
		if (!result.persisted) {
			const details = result.issues
				.map((issue) => issue.message)
				.filter(Boolean)
				.join(" ");
			set({
				presetError: `The recipe was rejected${details ? `: ${details}` : "."}`,
			});
			return false;
		}
		set({
			serverPresets: (get().serverPresets ?? []).map((item) =>
				item.id === result.row.id ? result.row : item,
			),
			presetError: null,
		});
		return true;
	},

	deletePreset: async (id: string): Promise<boolean> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return false;
		const result = await api.deleteAmountPreset(id);
		if (get().engine !== engine) return false;
		if (result instanceof Error) {
			set({
				presetError: messageFor(result, "The recipe could not be deleted."),
			});
			return false;
		}
		set({
			serverPresets: (get().serverPresets ?? []).filter(
				(item) => item.id !== id,
			),
			presetError: null,
		});
		return true;
	},

	movePreset: async (id: string, beforeId: string | null): Promise<boolean> => {
		const { engine } = get();
		const api = engine.client;
		if (!api) return false;
		const result = await api.moveAmountPreset(id, beforeId);
		if (get().engine !== engine) return false;
		if (result instanceof Error) {
			set({
				presetError: messageFor(result, "The recipe could not be moved."),
			});
			return false;
		}
		await get().refreshPresets();
		return true;
	},
}));

/** Recovery action for a workspace failure, mirroring the toast it floats. */
function workspaceToastAction(state: WorkspaceData): ToastAction {
	const stale =
		(state.workspace?.draftStale ?? false) || state.errorCode === "stale-draft";
	if (stale)
		return {
			label: "Discard draft and load latest",
			onAction: () => void useWorkspaceStore.getState().reloadDraft(),
		};
	const storageConflict =
		state.errorCode === "storage-conflict" ||
		(state.error?.includes("changed in another tab") ?? false);
	if (storageConflict)
		return {
			label: "Reload latest saved plan",
			onAction: () => window.location.reload(),
		};
	return {
		label: "Retry server request",
		onAction: () => void useWorkspaceStore.getState().retry(),
	};
}

/**
 * Explicit failure triggers for the notification stack. One subscription
 * covers every branch that reports a workspace, notice, or preset error,
 * so no failure path needs its own notify call. Toasts are sticky: they
 * live until dismissed, and a repeated failure re-floats by key.
 */
useWorkspaceStore.subscribe((state, previous) => {
	if (
		state.error &&
		state.error !== previous.error &&
		state.errorCode !== "missing-model" &&
		!state.error.includes("no financial model")
	)
		notifyError("workspace", state.error, workspaceToastAction(state));
	else if (!state.error && previous.error) dismissKey("workspace");
	if (state.notice && state.notice !== previous.notice)
		notifySuccess("workspace-notice", state.notice, () =>
			useWorkspaceStore.getState().dismissNotice(),
		);
	else if (!state.notice && previous.notice) dismissKey("workspace-notice");
	if (state.presetError && state.presetError !== previous.presetError)
		notifyError("amount-presets", state.presetError);
	else if (!state.presetError && previous.presetError)
		dismissKey("amount-presets");
});

/** Stop old callbacks without deleting account-owned data during verification. */
export function suspendWorkspaceForVerification(): void {
	const engine = useWorkspaceStore.getState().engine;
	engine.mounted = false;
	engine.workspaceEpoch += 1;
	engine.hydrationController?.abort();
	engine.saveController?.abort();
	useWorkspaceStore.setState({
		engine: { ...freshEngine(), volatileState: engine.volatileState },
	});
}

/** Abandon the old owner before a different resource can mount its workspace. */
export function resetWorkspaceForResource({
	preserveVolatile = false,
} = {}): void {
	const engine = useWorkspaceStore.getState().engine;
	const volatileState = preserveVolatile ? engine.volatileState : null;
	suspendWorkspaceForVerification();
	useWorkspaceStore.setState({
		...initialData(),
		engine: { ...freshEngine(), volatileState },
	});
}

/** Test hook: restores a pristine engine and data between cases. */
export function resetWorkspaceStore(): void {
	resetWorkspaceForResource();
}
