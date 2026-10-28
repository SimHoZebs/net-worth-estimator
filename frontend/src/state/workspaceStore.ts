import { create } from "zustand";
// State owner derives from the data's authority and lifetime, not its
// reader count. Saved model, pins, budget settings, projections, and
// mutation status live in TanStack Query (resource-scoped keys; scope
// changes cancel queries and clear private data). The shared unsaved changes,
// comparison baseline, theme, and projection controls live in Zustand here.
// Unsubmitted fields, selections, and pagination stay local. New server
// state gets a resource-scoped query and mutation, never a second cache.
import {
	ApiHttpError,
	displayPlanToBackendDocument,
	refreshDisplayPlanAccess,
	type FinancialModelDocument,
	type PlanPresentation,
} from "../api/index.ts";
import { getResourceScope, type ResourceScope } from "../auth/resourceScope.ts";
import { changesBetween, type Plan, validatePlan } from "../domain/model.ts";
import {
	loadRemoteState,
	persistRemoteState,
	readRemoteStateRaw,
	type RemoteLocalState,
} from "./remoteStorage.ts";
import {
	getServerModel,
	getServerStatus,
	workspaceIsBusy,
	type ServerModel,
} from "./workspaceResources.ts";
import { notifyError, notifySuccess } from "./notifications.ts";
import { reloadDraft } from "./workspaceWrites.ts";

export interface DraftState {
	draft: Plan | null;
	baseline: Plan | null;
	draftPresentation: PlanPresentation | null;
	baseFingerprint: string | null;
	baseRevision: string | null;
	scope: ResourceScope | null;
	expectedRaw: string | null | undefined;
	volatile: boolean;
	error: string | null;
	errorCode: "storage-conflict" | null;
}

const initialData = (): DraftState => ({
	draft: null,
	baseline: null,
	draftPresentation: null,
	baseFingerprint: null,
	baseRevision: null,
	scope: null,
	expectedRaw: undefined,
	volatile: false,
	error: null,
	errorCode: null,
});

export const staleDraftMessage =
	"This browser draft is stale because the authoritative server model changed after the draft was created. Saving and editing are blocked. Discard the draft and load the latest server model before continuing.";
export const missingIdentityDraftMessage =
	"This stale browser draft has no recorded server identity, so it cannot be checked safely against the current model. Saving and editing are blocked until it is discarded or explicitly recreated.";

export function draftConflict(
	state: DraftState,
	model = getServerModel(),
): string | null {
	if (!state.draft || !model?.document) return null;
	if (!state.baseFingerprint) return missingIdentityDraftMessage;
	// An in-memory edit has an observed baseline. A restored draft must prove its server revision.
	if (!state.baseRevision || !model.revision)
		return state.baseline &&
			!state.baseRevision &&
			!model.revision &&
			state.baseFingerprint === model.fingerprint
			? null
			: missingIdentityDraftMessage;
	return state.baseFingerprint !== model.fingerprint ||
		state.baseRevision !== model.revision
		? staleDraftMessage
		: null;
}

export function deriveDraftDocument(
	draft: Plan | null,
	sourceDocument: FinancialModelDocument | null,
	presentation: PlanPresentation | null,
): FinancialModelDocument | null {
	if (!draft) return null;
	try {
		return displayPlanToBackendDocument(draft, { sourceDocument, presentation })
			.document;
	} catch {
		return null;
	}
}

function localState(state: DraftState): RemoteLocalState {
	return {
		version: 1,
		draft: state.draft,
		draftPresentation: state.draft ? state.draftPresentation : null,
		baseFingerprint: state.draft ? state.baseFingerprint : null,
		baseRevision: state.draft ? state.baseRevision : null,
	};
}

function conversion(
	plan: Plan,
	model: ServerModel,
	presentation: PlanPresentation | null,
) {
	const result = displayPlanToBackendDocument(plan, {
		sourceDocument: model.document ?? null,
		presentation,
	});
	if (result.report.hasLosses) {
		const first = result.report.losses[0];
		throw new Error(
			`This change cannot be saved to the server: ${first?.path ?? first?.field} — ${first?.message}`,
		);
	}
	return result.document;
}

interface DraftActions {
	restore: (scope: ResourceScope) => void;
	reconcile: (model: ServerModel) => void;
	updatePlan: (next: Plan) => boolean;
	discard: (allowStale?: boolean) => boolean;
	acknowledgeSave: (draft: Plan) => boolean;
}

/** Client editing state only. Query owns server data and every request lifecycle. */
export const useWorkspaceStore = create<DraftState & DraftActions>()((
	set,
	get,
) => {
	const fail = (message: string, errorCode: DraftState["errorCode"] = null) => {
		set({ error: message, errorCode });
		notifyError(
			"workspace",
			message,
			message === staleDraftMessage || message === missingIdentityDraftMessage
				? {
						label: "Discard draft and load latest",
						onAction: () => void reloadDraft(),
					}
				: errorCode === "storage-conflict"
					? {
							label: "Reload last save",
							onAction: () => window.location.reload(),
						}
					: undefined,
		);
		return false;
	};
	const persist = (next: DraftState): boolean => {
		const result = persistRemoteState(
			localState(next),
			get().expectedRaw,
			getResourceScope(),
		);
		if (result) {
			set({ volatile: true });
			return fail(
				result.message,
				result.message.includes("changed in another tab")
					? "storage-conflict"
					: null,
			);
		}
		set({
			expectedRaw: JSON.stringify(localState(next)),
			volatile: false,
			error: null,
			errorCode: null,
		});
		return true;
	};
	const edit = (next: Plan) => {
		if (workspaceIsBusy())
			return fail(
				"Wait for the current server operation to finish before editing.",
			);
		const model = getServerModel();
		const saved = model?.conversion?.plan;
		if (!model || !saved)
			return fail("Load the server workspace before editing it.");
		const conflict = draftConflict(get(), model);
		if (conflict) return fail(conflict);
		const validated = validatePlan(next);
		if (validated instanceof Error) return fail(validated.message);
		const presentation =
			get().draftPresentation ?? model.conversion!.presentation;
		try {
			conversion(validated, model, presentation);
		} catch (error) {
			return fail(
				error instanceof Error
					? error.message
					: "The plan could not be converted.",
			);
		}
		const changed =
			changesBetween({ saved, current: validated }).length > 0 ||
			saved.updatedAt !== validated.updatedAt ||
			saved.revision !== validated.revision ||
			saved.readOnly !== validated.readOnly;
		const state: DraftState = {
			...get(),
			draft: changed ? validated : null,
			baseline: changed ? saved : null,
			draftPresentation: changed ? { ...presentation } : null,
			baseFingerprint: changed
				? (get().baseFingerprint ?? model.fingerprint)
				: null,
			baseRevision: changed
				? (get().baseRevision ?? model.revision ?? null)
				: null,
		};
		set(state);
		persist(state);
		return true;
	};
	return {
		...initialData(),
		restore: (scope) => {
			if (scope !== getResourceScope() || scope.status !== "ready") return;
			const raw = readRemoteStateRaw(scope);
			const stored = loadRemoteState(scope);
			const retained = get().volatile
				? localState(get())
				: stored instanceof Error
					? localState(get())
					: (stored ?? (get().draft ? localState(get()) : null));
			set({
				scope,
				expectedRaw: raw instanceof Error ? undefined : raw,
				baseline: null,
				draft: retained?.draft ?? null,
				draftPresentation: retained?.draftPresentation ?? null,
				baseFingerprint: retained?.baseFingerprint ?? null,
				baseRevision: retained?.baseRevision ?? null,
			});
			if (raw instanceof Error || stored instanceof Error) {
				set({ volatile: true });
				fail((raw instanceof Error ? raw : (stored as Error)).message);
			}
		},
		reconcile: (model) => {
			// A save acknowledges the exact draft it submitted. Access reconciliation must not replace it mid-write.
			if (workspaceIsBusy()) return;
			const current = get();
			if (!current.draft || !model.document || !model.conversion) return;
			const refreshed = refreshDisplayPlanAccess(current.draft, {
				document: model.document,
				status: getServerStatus() ?? { readOnly: true },
				presentation:
					current.draftPresentation ?? model.conversion.presentation,
			});
			set({
				draft: refreshed.plan,
				draftPresentation: refreshed.presentation,
				baseline:
					current.baseline ??
					(current.baseRevision && model.revision
						? model.conversion.plan
						: null),
			});
			const conflict = draftConflict(get(), model);
			if (conflict)
				notifyError("workspace", conflict, {
					label: "Discard draft and load latest",
					onAction: () => void reloadDraft(),
				});
		},
		updatePlan: (next) => edit(next),
		discard: (allowStale = false) => {
			if (!get().draft) return false;
			if (workspaceIsBusy())
				return fail(
					"Wait for the current server operation to finish before discarding changes.",
				);
			const conflict = draftConflict(get());
			if (conflict && !allowStale) return fail(conflict);
			const next = {
				...get(),
				draft: null,
				baseline: null,
				draftPresentation: null,
				baseFingerprint: null,
				baseRevision: null,
			};
			if (!persist(next)) return false;
			set(next);
			set({
				error: null,
				errorCode: null,
				volatile: false,
				expectedRaw: JSON.stringify(localState(next)),
			});
			notifySuccess(
				"workspace-notice",
				"Unsaved changes discarded. Your last save is restored.",
			);
			return true;
		},
		acknowledgeSave: (draft) => {
			if (get().draft !== draft) return false;
			const next = {
				...get(),
				draft: null,
				baseline: null,
				draftPresentation: null,
				baseFingerprint: null,
				baseRevision: null,
			};
			if (!persist(next)) return false;
			set(next);
			set({
				error: null,
				errorCode: null,
				volatile: false,
				expectedRaw: JSON.stringify(localState(next)),
			});
			return true;
		},
	};
});

export function selectDraftChangeCount(state: DraftState) {
	return state.draft && state.baseline
		? changesBetween({ saved: state.baseline, current: state.draft }).length
		: 0;
}

export function draftDocumentForSave(): FinancialModelDocument {
	const state = useWorkspaceStore.getState();
	const model = getServerModel();
	if (!state.draft || !model?.document || !model.conversion)
		throw new Error("There are no unsaved changes to save.");
	const conflict = draftConflict(state, model);
	if (conflict) throw new Error(conflict);
	if (getServerStatus()?.readOnly || state.draft.readOnly)
		throw new ApiHttpError({
			status: 403,
			message: "The server is read-only. Your changes remain unsaved.",
		});
	return conversion(
		state.draft,
		model,
		state.draftPresentation ?? model.conversion.presentation,
	);
}

export function resetWorkspaceForResource({ preserveVolatile = false } = {}) {
	const previous = useWorkspaceStore.getState();
	useWorkspaceStore.setState({
		...initialData(),
		...(preserveVolatile && previous.volatile
			? {
					draft: previous.draft,
					draftPresentation: previous.draftPresentation,
					baseFingerprint: previous.baseFingerprint,
					baseRevision: previous.baseRevision,
					volatile: true,
				}
			: {}),
	});
}
export const resetWorkspaceStore = resetWorkspaceForResource;
