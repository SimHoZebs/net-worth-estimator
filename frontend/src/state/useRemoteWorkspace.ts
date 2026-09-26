import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type AdapterReport,
	ApiHttpError,
	type ApiRequestOptions,
	backendToDisplayPlan,
	createApiClient,
	displayPlanToBackendDocument,
	type FinancialModelDocument,
	type FinancialModelResponse,
	type IncomeDataSnapshot,
	type PlanConversion,
	type PlanSidecar,
	type ServerStatus,
} from "../api/index.ts";
import { changesBetween, type Plan, validatePlan } from "../domain/model.ts";
import {
	loadRemoteState,
	persistRemoteState,
	REMOTE_STORAGE_KEY,
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
	sidecar: PlanSidecar | null;
	savedSidecar: PlanSidecar | null;
	draftSidecar: PlanSidecar | null;
	loading: boolean;
	error: string | null;
	notice: string;
	volatile: boolean;
	stale: boolean;
	draftStale: boolean;
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
	sidecar: PlanSidecar | null,
	sourcePath?: string,
): ReverseConversion | Error {
	try {
		return displayPlanToBackendDocument(plan, { sidecar, sourcePath });
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
	sidecar: PlanSidecar | null,
): RemoteLocalState {
	return {
		version: 1,
		draft: workspace.draft,
		draftSidecar: workspace.draft ? sidecar : null,
		baseFingerprint: workspace.draft ? workspace.baseFingerprint : null,
		baseRevision: workspace.draft ? workspace.baseRevision : null,
		snapshot: workspace.snapshot,
	};
}

function sidecarForPlan(plan: Plan, sidecar: PlanSidecar | null): PlanSidecar {
	const base = sidecar ?? {
		version: 1 as const,
		presentation: {
			accounts: {},
			movements: {},
			provisionalFields: [],
		},
	};
	return {
		...base,
		projectionStartDate: plan.startDate,
		presentation: {
			...base.presentation,
			name: plan.name,
			origin: plan.origin,
			updatedAt: plan.updatedAt,
			revision: plan.revision,
			assumptions: plan.assumptions,
		},
	};
}

function draftSidecarForPlan(
	plan: Plan,
	sidecar: PlanSidecar | null,
): PlanSidecar {
	const base = sidecar ?? {
		version: 1 as const,
		presentation: {
			accounts: {},
			movements: {},
			provisionalFields: [],
		},
	};
	return {
		...base,
		projectionStartDate: plan.startDate,
		presentation: { ...base.presentation },
	};
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

export function useRemoteWorkspace({
	client,
	authToken,
}: UseRemoteWorkspaceOptions = {}): RemoteWorkspaceState {
	const api = useMemo(() => client ?? createApiClient(), [client]);
	const [workspace, setWorkspace] = useState<RemoteWorkspace | null>(null);
	const [status, setStatus] = useState<ServerStatus | null>(null);
	const [serverDocument, setServerDocument] =
		useState<FinancialModelDocument | null>(null);
	const [serverRevision, setServerRevision] = useState<string | null>(null);
	const [draftDocument, setDraftDocument] =
		useState<FinancialModelDocument | null>(null);
	const [recoveryDraft, setRecoveryDraft] = useState<Plan | null>(null);
	const [incomeData, setIncomeData] = useState<IncomeDataSnapshot | null>(null);
	const [adapterReport, setAdapterReport] = useState<AdapterReport | null>(
		null,
	);
	const [savedSidecar, setSavedSidecar] = useState<PlanSidecar | null>(null);
	const [draftSidecar, setDraftSidecar] = useState<PlanSidecar | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	const [volatile, setVolatile] = useState(false);
	const [authRequiredState, setAuthRequiredState] = useState(false);
	const [writeBlocked, setWriteBlocked] = useState(false);
	const mounted = useRef(true);
	const hydrationController = useRef<AbortController | null>(null);
	const saveController = useRef<AbortController | null>(null);
	const saving = useRef(false);
	const expectedRaw = useRef<string | null | undefined>(undefined);
	const workspaceRef = useRef<RemoteWorkspace | null>(null);
	const savedSidecarRef = useRef<PlanSidecar | null>(null);
	const draftSidecarRef = useRef<PlanSidecar | null>(null);
	const draftDocumentRef = useRef<FinancialModelDocument | null>(null);
	const serverDocumentRef = useRef<FinancialModelDocument | null>(null);
	const serverFingerprintRef = useRef<string | null>(null);
	const serverRevisionRef = useRef<string | null>(null);
	const volatileStateRef = useRef<RemoteLocalState | null>(null);
	const statusRef = useRef<ServerStatus | null>(null);
	const writeBlockedRef = useRef(false);
	const workspaceEpoch = useRef(0);
	const pendingHydrate = useRef(false);
	const activeSaveToken = useRef<symbol | null>(null);
	const hydrating = useRef(false);
	const hydrationPromise = useRef<Promise<void> | null>(null);
	const pendingHydrationError = useRef<string | null>(null);
	workspaceRef.current = workspace;
	savedSidecarRef.current = savedSidecar;
	draftSidecarRef.current = draftSidecar;
	draftDocumentRef.current = draftDocument;
	serverDocumentRef.current = serverDocument;
	statusRef.current = status;
	writeBlockedRef.current = writeBlocked;

	const preserveQueuedError = useCallback((message: string) => {
		pendingHydrationError.current = message;
	}, []);

	const reportStorageError = useCallback((storageError: StorageError) => {
		setError(storageError.message);
		setVolatile(true);
	}, []);

	const writeLocalState = useCallback(
		(next: RemoteLocalState, fallback: RemoteLocalState = next): boolean => {
			const result = persistRemoteState(next, expectedRaw.current);
			if (result) {
				volatileStateRef.current = fallback;
				reportStorageError(result);
				return false;
			}
			expectedRaw.current = JSON.stringify(next);
			volatileStateRef.current = null;
			setVolatile(false);
			return true;
		},
		[reportStorageError],
	);

	const hydrate = useCallback(
		async (options?: { deferDuringSave?: boolean }) => {
			if (saving.current && options?.deferDuringSave !== false) {
				pendingHydrate.current = true;
				return;
			}
			if (hydrating.current)
				return hydrationPromise.current ?? Promise.resolve();
			hydrationController.current?.abort();
			const controller = new AbortController();
			hydrationController.current = controller;
			let resolveHydration!: () => void;
			const completion = new Promise<void>((resolve) => {
				resolveHydration = resolve;
			});
			hydrationPromise.current = completion;
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
			workspaceEpoch.current += 1;
			const restoreError = pendingHydrationError.current;
			pendingHydrationError.current = null;
			hydrating.current = true;
			setLoading(true);
			setError(restoreError);
			const finishHydration = () => {
				clearTimeout(hydrationTimer);
				if (hydrationPromise.current === completion)
					hydrationPromise.current = null;
				hydrating.current = false;
				resolveHydration();
			};
			const raw = readRemoteStateRaw();
			const stored = loadRemoteState();
			const storageReadError = raw instanceof Error || stored instanceof Error;
			if (raw instanceof Error) reportStorageError(raw);
			if (stored instanceof Error) reportStorageError(stored);
			const storedState = stored instanceof Error ? null : stored;
			const volatileState = volatileStateRef.current;
			const inMemoryState = workspaceRef.current
				? localStateFor(workspaceRef.current, draftSidecarRef.current)
				: null;
			const localState = volatileState ?? storedState ?? inMemoryState;
			setRecoveryDraft(localState?.draft ?? null);
			expectedRaw.current = raw instanceof Error ? undefined : raw;
			const clearUnavailableWorkspace = () => {
				workspaceEpoch.current += 1;
				saveController.current?.abort();
				workspaceRef.current = null;
				serverDocumentRef.current = null;
				serverFingerprintRef.current = null;
				serverRevisionRef.current = null;
				statusRef.current = null;
				setWorkspace(null);
				setServerDocument(null);
				setServerRevision(null);
				setStatus(null);
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
				if (mounted.current && (!controller.signal.aborted || timedOut)) {
					clearUnavailableWorkspace();
					markApiFailure(
						setError,
						setAuthRequiredState,
						setWriteBlocked,
						cause,
						timedOut
							? "The server workspace load timed out. Retry the connection."
							: "The server workspace could not be loaded. Retry the connection.",
					);
					setLoading(false);
				}
				finishHydration();
				return;
			}
			const [statusResult, modelResult, incomeResult] = responses;
			if (
				!mounted.current ||
				controller.signal.aborted ||
				hydrationController.current !== controller
			) {
				finishHydration();
				return;
			}
			if (statusResult instanceof Error) {
				clearUnavailableWorkspace();
				markApiFailure(
					setError,
					setAuthRequiredState,
					setWriteBlocked,
					statusResult,
					"The server status could not be loaded. Retry the connection.",
				);
				setLoading(false);
				finishHydration();
				return;
			}
			if (modelResult instanceof Error) {
				clearUnavailableWorkspace();
				markApiFailure(
					setError,
					setAuthRequiredState,
					setWriteBlocked,
					modelResult,
					"The server financial model could not be loaded. Retry the connection.",
				);
				setLoading(false);
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
				setIncomeData(null);
				setError(incomeError);
			} else {
				setIncomeData(incomeResult);
			}
			statusRef.current = statusResult;
			setStatus(statusResult);
			setAuthRequiredState(statusResult.authEnabled);
			setWriteBlocked(false);
			const model = modelResult.document;
			if (!model) {
				workspaceRef.current = null;
				setWorkspace(null);
				serverDocumentRef.current = null;
				serverFingerprintRef.current = null;
				serverRevisionRef.current = null;
				setServerDocument(null);
				setServerRevision(null);
				setRecoveryDraft(localState?.draft ?? null);
				setError(
					"The server has no financial model to display. Import and review a model before continuing. Any browser draft remains available for export.",
				);
				setLoading(false);
				finishHydration();
				return;
			}
			serverDocumentRef.current = model;
			serverRevisionRef.current = modelResult.revision ?? null;
			const fingerprint = serverDocumentFingerprint(model);
			serverFingerprintRef.current = fingerprint;
			setServerDocument(model);
			setServerRevision(modelResult.revision ?? null);

			let conversion: PlanConversion;
			try {
				conversion = backendToDisplayPlan({
					document: model,
					status: statusResult,
				});
			} catch (cause) {
				clearUnavailableWorkspace();
				setError(
					messageFor(
						cause,
						"The server model could not be converted for display.",
					),
				);
				setLoading(false);
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
			const draftStale =
				identityMissing || fingerprintChanged || revisionChanged;
			const sidecar = storedDraft
				? draftSidecarForPlan(
						storedDraft,
						localState?.draftSidecar ?? conversion.sidecar,
					)
				: null;
			const convertedDraft = storedDraft
				? conversionOrError(storedDraft, sidecar, model.sourcePath)
				: null;
			const convertedDraftDocument =
				convertedDraft instanceof Error || convertedDraft === null
					? null
					: convertedDraft.document;
			setRecoveryDraft(null);
			const nextWorkspace: RemoteWorkspace = {
				version: 1,
				saved: savedPlan,
				draft: storedDraft,
				baseFingerprint,
				baseRevision,
				draftStale,
				snapshot: localState?.snapshot ?? null,
			};
			workspaceRef.current = nextWorkspace;
			savedSidecarRef.current = conversion.sidecar;
			draftSidecarRef.current = sidecar;
			draftDocumentRef.current = convertedDraftDocument;
			setWorkspace(nextWorkspace);
			setStatus(statusResult);
			setServerDocument(model);
			setDraftDocument(convertedDraftDocument);
			setAdapterReport(conversion.report);
			setSavedSidecar(conversion.sidecar);
			setDraftSidecar(sidecar);
			setAuthRequiredState(statusResult.authEnabled);
			setWriteBlocked(false);
			if (draftStale) setVolatile(true);

			const shouldRetryStorage = Boolean(
				volatileState ||
					(!storedState && inMemoryState) ||
					(storedDraft && storedBaseFingerprint === null),
			);
			const local = localStateFor(nextWorkspace, sidecar);
			const storageWriteFailed =
				shouldRetryStorage && !writeLocalState(local, local);
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
				setError([message, conversionMessage].filter(Boolean).join(" "));
			} else if (convertedDraft instanceof Error)
				setError(convertedDraft.message);
			else if (
				!incomeError &&
				!storageWriteFailed &&
				(!storageReadError || shouldRetryStorage)
			)
				setError(restoreError);
			setLoading(false);
			finishHydration();
		},
		[api, reportStorageError, writeLocalState],
	);

	useEffect(() => {
		mounted.current = true;
		void hydrate();
		return () => {
			mounted.current = false;
			// The in-flight load is deliberately not aborted here. React's
			// development double-mount remounts this effect immediately, and
			// aborting would cancel the only attempt while the remount reuses
			// the same in-flight promise, leaving the app loading forever.
			// Superseded loads are aborted by hydrate() itself; the
			// mounted flag keeps a completed load from updating state.
			saveController.current?.abort();
		};
	}, [hydrate]);

	const updatePlan = useCallback(
		(next: Plan): boolean => {
			if (saving.current) {
				setError(
					"Wait for the current server save to finish before editing the plan.",
				);
				return false;
			}
			if (hydrating.current) {
				setError(
					"Wait for the current server load to finish before editing the plan.",
				);
				return false;
			}
			if (!serverRevisionRef.current) {
				setError(
					"The server did not provide a model content identity. Editing and saving are blocked until the current model supports revisions.",
				);
				return false;
			}
			const current = workspaceRef.current;
			if (!current) {
				setError("Load the server workspace before editing it.");
				return false;
			}
			if (current.draftStale) {
				setError(staleDraftMessage);
				return false;
			}
			const validated = validatePlan(next);
			if (validated instanceof Error) {
				setError(validated.message);
				return false;
			}
			const draft = planHasChanges(current.saved, validated) ? validated : null;
			const conversionSidecar =
				draftSidecarRef.current ?? savedSidecarRef.current;
			const conversion = draft
				? conversionOrError(
						validated,
						conversionSidecar,
						serverDocumentRef.current?.sourcePath,
					)
				: null;
			if (conversion instanceof Error) {
				setError(conversion.message);
				return false;
			}
			if (conversion?.report.hasLosses) {
				setError(
					conversionLossError(
						conversion,
						"This change cannot be saved to the server",
					),
				);
				return false;
			}
			const sidecar = draft
				? draftSidecarForPlan(validated, conversionSidecar)
				: null;
			const document = conversion?.document ?? null;
			const nextWorkspace = {
				...current,
				draft,
				baseFingerprint: draft
					? (current.baseFingerprint ?? serverFingerprintRef.current)
					: null,
				baseRevision: draft
					? (current.baseRevision ?? serverRevisionRef.current)
					: null,
				draftStale: false,
			};
			workspaceRef.current = nextWorkspace;
			draftDocumentRef.current = document;
			setWorkspace(nextWorkspace);
			setDraftSidecar(sidecar);
			draftSidecarRef.current = sidecar;
			setDraftDocument(document);
			const nextLocal = localStateFor(nextWorkspace, sidecar);
			const persisted = writeLocalState(nextLocal, nextLocal);
			setNotice("Temporary version updated. Saved server plan unchanged.");
			if (persisted) setError(null);
			return true;
		},
		[writeLocalState],
	);

	const save = useCallback(async (): Promise<boolean> => {
		const current = workspaceRef.current;
		if (!current?.draft) {
			setError("There is no temporary server plan to save.");
			return false;
		}
		if (current.draftStale) {
			setError(staleDraftMessage);
			return false;
		}
		if (!current.baseRevision || !serverRevisionRef.current) {
			setError(
				"The server did not provide a model content identity. Saving is blocked until the current server model is reloaded with revision support.",
			);
			return false;
		}
		const conversion = conversionOrError(
			current.draft,
			draftSidecarRef.current ?? savedSidecarRef.current,
			serverDocumentRef.current?.sourcePath,
		);
		if (conversion instanceof Error) {
			setError(
				`${conversion.message} The temporary plan remains available locally.`,
			);
			return false;
		}
		if (conversion.report.hasLosses) {
			setError(
				`${conversionLossError(conversion, "The temporary plan cannot be saved to the server")}. It remains available locally.`,
			);
			return false;
		}
		if (statusRef.current?.readOnly || writeBlockedRef.current) {
			setError(
				"The server is read-only. The temporary plan remains available for export.",
			);
			return false;
		}
		if (hydrating.current) {
			setError("Wait for the current server load to finish before saving.");
			return false;
		}
		if (saving.current) return false;
		const operationEpoch = workspaceEpoch.current;
		const saveToken = Symbol();
		activeSaveToken.current = saveToken;
		saving.current = true;
		saveController.current?.abort();
		const controller = new AbortController();
		saveController.current = controller;
		setLoading(true);
		setError(null);
		try {
			const document = conversion.document;
			const putResult = await api.putModel(document, {
				authToken,
				signal: controller.signal,
				ifMatch: current.baseRevision ?? undefined,
			});
			if (
				!mounted.current ||
				controller.signal.aborted ||
				workspaceEpoch.current !== operationEpoch
			)
				return false;
			if (putResult instanceof Error) {
				if (statusFor(putResult) === 412) {
					const conflicted = { ...current, draftStale: true };
					workspaceRef.current = conflicted;
					setWorkspace(conflicted);
					writeLocalState(
						localStateFor(conflicted, draftSidecarRef.current),
						localStateFor(current, draftSidecarRef.current),
					);
					const message =
						"The server model changed after this draft was created. The draft remains available locally, but saving is blocked until it is discarded or reloaded.";
					setError(message);
					preserveQueuedError(message);
					return false;
				}
				const message = markApiFailure(
					setError,
					setAuthRequiredState,
					setWriteBlocked,
					putResult,
					"The temporary plan could not be saved to the server. It remains available locally.",
				);
				preserveQueuedError(message);
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
				setError(message);
				preserveQueuedError(message);
				return false;
			}
			const authoritative = await api.getModel({ signal: controller.signal });
			if (
				!mounted.current ||
				controller.signal.aborted ||
				workspaceEpoch.current !== operationEpoch
			)
				return false;
			if (authoritative instanceof Error) {
				const message = markApiFailure(
					setError,
					setAuthRequiredState,
					setWriteBlocked,
					authoritative,
					"The save completed, but the authoritative model could not be reloaded. Your temporary plan remains available locally.",
				);
				preserveQueuedError(message);
				return false;
			}
			if (!authoritative.document) {
				const message =
					"The save completed, but the server returned no authoritative model. Your temporary plan remains available locally.";
				setError(message);
				preserveQueuedError(message);
				return false;
			}
			let authoritativeConversion: PlanConversion;
			try {
				authoritativeConversion = backendToDisplayPlan({
					document: authoritative.document,
					status: statusRef.current ?? { readOnly: false, authEnabled: false },
					sidecar: draftSidecarRef.current ?? savedSidecarRef.current,
				});
			} catch (cause) {
				const message = messageFor(
					cause,
					"The authoritative model was saved but could not be converted for display. Your temporary plan remains available locally.",
				);
				setError(message);
				preserveQueuedError(message);
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
				draftSidecar: null,
				baseFingerprint: null,
				baseRevision: null,
				snapshot: current.snapshot,
			};
			const fallbackLocal = localStateFor(
				current,
				draftSidecarRef.current ?? savedSidecarRef.current,
			);
			const persisted = writeLocalState(nextLocal, fallbackLocal);
			const retainedSidecar = persisted ? null : fallbackLocal.draftSidecar;
			const retainedDocument = persisted ? null : draftDocumentRef.current;
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
			workspaceRef.current = retainedWorkspace;
			savedSidecarRef.current = authoritativeConversion.sidecar;
			draftSidecarRef.current = retainedSidecar;
			draftDocumentRef.current = retainedDocument;
			serverDocumentRef.current = authoritative.document;
			serverFingerprintRef.current = authoritativeFingerprint;
			serverRevisionRef.current = authoritative.revision ?? null;
			setServerDocument(authoritative.document);
			setServerRevision(authoritative.revision ?? null);
			setDraftDocument(retainedDocument);
			setAdapterReport(authoritativeConversion.report);
			setSavedSidecar(authoritativeConversion.sidecar);
			setDraftSidecar(retainedSidecar);
			setWorkspace(retainedWorkspace);
			setWriteBlocked(false);
			setNotice("Plan saved on the server.");
			if (!persisted)
				setError(
					"The server model was saved, but browser draft storage could not be updated. The temporary plan remains available locally.",
				);
			return persisted;
		} catch (cause) {
			if (
				!controller.signal.aborted &&
				workspaceEpoch.current === operationEpoch
			) {
				const message = markApiFailure(
					setError,
					setAuthRequiredState,
					setWriteBlocked,
					cause,
					"The server save failed. The temporary plan remains available locally.",
				);
				preserveQueuedError(message);
			}
			return false;
		} finally {
			if (activeSaveToken.current === saveToken) {
				activeSaveToken.current = null;
				saving.current = false;
				if (mounted.current && workspaceEpoch.current === operationEpoch)
					setLoading(false);
				if (pendingHydrate.current && mounted.current) {
					pendingHydrate.current = false;
					await hydrate();
				}
			}
		}
	}, [api, authToken, hydrate, preserveQueuedError, writeLocalState]);

	const importServerDocument = useCallback(
		async (document: FinancialModelDocument): Promise<boolean> => {
			if (workspaceRef.current) {
				setError(
					"A server model is already loaded. Use the reviewed import action in Data & sources.",
				);
				return false;
			}
			if (statusRef.current?.readOnly || writeBlockedRef.current) {
				setError(
					"The server is read-only. The selected model was not uploaded.",
				);
				return false;
			}
			if (hydrating.current) {
				setError(
					"Wait for the current server load to finish before importing.",
				);
				return false;
			}
			if (saving.current) return false;
			const saveToken = Symbol();
			activeSaveToken.current = saveToken;
			saving.current = true;
			saveController.current?.abort();
			const controller = new AbortController();
			saveController.current = controller;
			setLoading(true);
			setError(null);
			try {
				const result = await api.putModel(document, {
					authToken,
					signal: controller.signal,
					ifMatch: "*",
				});
				if (!mounted.current || controller.signal.aborted) return false;
				if (result instanceof Error) {
					if (statusFor(result) === 412) {
						await hydrate({ deferDuringSave: false });
						if (!workspaceRef.current) return false;
						const message =
							"A server model was created while this import was being reviewed. The latest server model has been loaded; review it before importing again.";
						setError(message);
						preserveQueuedError(message);
						return false;
					}
					const message = markApiFailure(
						setError,
						setAuthRequiredState,
						setWriteBlocked,
						result,
						"The selected model could not be imported. The server has no active model.",
					);
					preserveQueuedError(message);
					return false;
				}
				setNotice("Server model imported. Loading the authoritative model.");
				await hydrate({ deferDuringSave: false });
				return mounted.current && Boolean(workspaceRef.current);
			} catch (cause) {
				if (!controller.signal.aborted) {
					const message = markApiFailure(
						setError,
						setAuthRequiredState,
						setWriteBlocked,
						cause,
						"The selected model could not be imported. The server has no active model.",
					);
					preserveQueuedError(message);
				}
				return false;
			} finally {
				if (activeSaveToken.current === saveToken) {
					activeSaveToken.current = null;
					saving.current = false;
					if (mounted.current) setLoading(false);
					if (pendingHydrate.current && mounted.current) {
						pendingHydrate.current = false;
						await hydrate();
					}
				}
			}
		},
		[api, authToken, hydrate, preserveQueuedError],
	);

	const discard = useCallback((): boolean => {
		if (hydrating.current || saving.current) {
			setError(
				"Wait for the current server operation to finish before discarding changes.",
			);
			return false;
		}
		const current = workspaceRef.current;
		if (!current) return false;
		if (current.draftStale) {
			setError(staleDraftMessage);
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
		const fallbackLocal = localStateFor(current, draftSidecarRef.current);
		const persisted = writeLocalState(nextLocal, fallbackLocal);
		if (!persisted) return false;
		workspaceRef.current = nextWorkspace;
		draftDocumentRef.current = null;
		draftSidecarRef.current = null;
		setWorkspace(nextWorkspace);
		setDraftSidecar(null);
		setDraftDocument(null);
		setNotice("Temporary changes discarded. Saved server plan restored.");
		setError(null);
		return true;
	}, [writeLocalState]);

	const reloadDraft = useCallback(async (): Promise<boolean> => {
		if (hydrating.current || saving.current) {
			setError(
				"Wait for the current server operation to finish before reloading the draft.",
			);
			return false;
		}
		const current = workspaceRef.current;
		if (!current) return false;
		const nextWorkspace: RemoteWorkspace = {
			...current,
			draft: null,
			baseFingerprint: null,
			baseRevision: null,
			draftStale: false,
		};
		const nextLocal = localStateFor(nextWorkspace, null);
		const fallbackLocal = localStateFor(current, draftSidecarRef.current);
		const persisted = writeLocalState(nextLocal, fallbackLocal);
		if (!persisted) return false;
		workspaceRef.current = nextWorkspace;
		draftDocumentRef.current = null;
		draftSidecarRef.current = null;
		setWorkspace(nextWorkspace);
		setDraftDocument(null);
		setDraftSidecar(null);
		setError(null);
		setNotice("Stale draft discarded. Loading the latest server model.");
		await hydrate();
		return mounted.current && workspaceRef.current !== null;
	}, [hydrate, writeLocalState]);

	const replace = useCallback(
		(next: Plan): boolean => {
			if (hydrating.current || saving.current) {
				setError(
					"Wait for the current server operation to finish before replacing the plan.",
				);
				return false;
			}
			const current = workspaceRef.current;
			if (!current) {
				setError("Load the server workspace before replacing it.");
				return false;
			}
			if (current.draft) {
				setError(
					"Save or discard the current temporary plan before importing another plan.",
				);
				return false;
			}
			const validated = validatePlan(next);
			if (validated instanceof Error) {
				setError(validated.message);
				return false;
			}
			let conversion: ReturnType<typeof displayPlanToBackendDocument>;
			try {
				conversion = displayPlanToBackendDocument(validated, {
					sidecar: savedSidecarRef.current,
					sourcePath: serverDocumentRef.current?.sourcePath,
				});
			} catch (cause) {
				setError(
					messageFor(
						cause,
						"The imported display plan could not be reviewed for server conversion.",
					),
				);
				return false;
			}
			if (conversion.report.hasLosses) {
				const firstLoss = conversion.report.losses[0];
				setError(
					`This import needs explicit conversion review before it can replace the server model${firstLoss ? `: ${firstLoss.message}` : "."}`,
				);
				return false;
			}
			const nextWorkspace: RemoteWorkspace = {
				...current,
				draft: validated,
				baseFingerprint: serverFingerprintRef.current,
				baseRevision: serverRevisionRef.current,
				draftStale: false,
				snapshot: null,
			};
			const sidecar = sidecarForPlan(validated, savedSidecarRef.current);
			workspaceRef.current = nextWorkspace;
			draftSidecarRef.current = sidecar;
			draftDocumentRef.current = conversion.document;
			setWorkspace(nextWorkspace);
			setDraftSidecar(sidecar);
			setDraftDocument(conversion.document);
			const nextLocal = localStateFor(nextWorkspace, sidecar);
			const persisted = writeLocalState(nextLocal, nextLocal);
			setNotice("Imported plan is ready for review and save.");
			if (persisted) setError(null);
			return true;
		},
		[writeLocalState],
	);

	const capture = useCallback(
		(snapshot: Snapshot) => {
			if (hydrating.current || saving.current) {
				setError(
					"Wait for the current server operation to finish before capturing a comparison.",
				);
				return;
			}
			const current = workspaceRef.current;
			if (!current) return;
			const nextWorkspace = { ...current, snapshot };
			workspaceRef.current = nextWorkspace;
			setWorkspace(nextWorkspace);
			const nextLocal = localStateFor(nextWorkspace, draftSidecarRef.current);
			const persisted = writeLocalState(nextLocal, nextLocal);
			setNotice("Comparison snapshot captured. It contains measures only.");
			if (persisted) setError(null);
		},
		[writeLocalState],
	);

	const retry = useCallback(async () => {
		if (hydrating.current) {
			await hydrationPromise.current;
			return;
		}
		if (saving.current) {
			pendingHydrate.current = true;
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			if (!saving.current) {
				if (hydrating.current) await hydrationPromise.current;
				return;
			}
			workspaceEpoch.current += 1;
			activeSaveToken.current = null;
			saveController.current?.abort();
			saveController.current = null;
			saving.current = false;
			pendingHydrate.current = false;
			await hydrate({ deferDuringSave: false });
			return;
		}
		await hydrate();
	}, [hydrate]);

	return {
		workspace,
		plan: workspace?.draft ?? workspace?.saved ?? null,
		status,
		serverDocument,
		serverRevision,
		draftDocument,
		recoveryDraft,
		incomeData,
		adapterReport,
		sidecar: savedSidecar,
		savedSidecar,
		draftSidecar,
		loading,
		error,
		notice,
		volatile,
		stale: Boolean(workspace?.draftStale),
		draftStale: Boolean(workspace?.draftStale),
		readOnly: Boolean(status?.readOnly || writeBlocked),
		authRequired: authRequiredState,
		updatePlan,
		save,
		discard,
		reloadDraft,
		replace,
		capture,
		importServerDocument,
		retry,
		dismissNotice: () => setNotice(""),
	};
}

export { REMOTE_STORAGE_KEY };
