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
import { getAccountScope, type AccountScope } from "../auth/resourceScope.ts";
import { changesBetween, type Plan, validatePlan } from "../domain/model.ts";
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
	scope: AccountScope | null;
	error: string | null;
}

const initialData = (): DraftState => ({
	draft: null,
	baseline: null,
	draftPresentation: null,
	baseFingerprint: null,
	baseRevision: null,
	scope: null,
	error: null,
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
	restore: (scope: AccountScope) => void;
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
	const fail = (message: string) => {
		set({ error: message });
		notifyError(
			"workspace",
			message,
			message === staleDraftMessage || message === missingIdentityDraftMessage
				? {
						label: "Discard draft and load latest",
						onAction: () => void reloadDraft(),
					}
				: undefined,
		);
		return false;
	};
	const edit = (next: Plan, replacing: boolean) => {
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
			orderChanged(saved, validated) ||
			changesBetween({ saved, current: validated }).length > 0 ||
			saved.updatedAt !== validated.updatedAt ||
			saved.revision !== validated.revision ||
			saved.readOnly !== validated.readOnly;
		set({
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
			error: null,
		});
		notifySuccess(
			"workspace-notice",
			replacing
				? "Imported plan is ready for review and save."
				: "Unsaved changes updated. Saved plan unchanged.",
		);
		return true;
	};
	return {
		...initialData(),
		restore: (scope) => {
			if (scope !== getAccountScope() || scope.status !== "ready") return;
			set({
				scope,
				baseline: null,
			});
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
		updatePlan: (next) => edit(next, false),
		discard: (allowStale = false) => {
			if (!get().draft) return false;
			if (workspaceIsBusy())
				return fail(
					"Wait for the current server operation to finish before discarding changes.",
				);
			const conflict = draftConflict(get());
			if (conflict && !allowStale) return fail(conflict);
			set({
				...get(),
				draft: null,
				baseline: null,
				draftPresentation: null,
				baseFingerprint: null,
				baseRevision: null,
				error: null,
			});
			notifySuccess(
				"workspace-notice",
				"Unsaved changes discarded. Your last save is restored.",
			);
			return true;
		},
		acknowledgeSave: (draft) => {
			if (get().draft !== draft) return false;
			set({
				...get(),
				draft: null,
				baseline: null,
				draftPresentation: null,
				baseFingerprint: null,
				baseRevision: null,
				error: null,
			});
			return true;
		},
	};
});

export function orderChanged(saved: Plan | null, current: Plan | null) {
	if (!saved || !current) return false;
	return (
		["accounts", "transactions", "plannedPurchases", "evaluations"] as const
	).some((key) => {
		const before = (saved[key] ?? []).map((item) => item.id).join(",");
		const after = (current[key] ?? []).map((item) => item.id).join(",");
		return before !== after;
	});
}

export function selectDraftChangeCount(state: DraftState) {
	if (!state.draft || !state.baseline) return 0;
	const count = changesBetween({
		saved: state.baseline,
		current: state.draft,
	}).length;
	if (count > 0) return count;
	// Pure reorders carry no content changes but still need a DraftBar with
	// a save and discard path when their immediate save fails.
	return orderChanged(state.baseline, state.draft) ? 1 : 0;
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

export function resetWorkspaceForResource({ preserveDraft = false } = {}) {
	const previous = useWorkspaceStore.getState();
	useWorkspaceStore.setState({
		...initialData(),
		...(preserveDraft && previous.draft
			? {
					draft: previous.draft,
					baseline: previous.baseline,
					draftPresentation: previous.draftPresentation,
					baseFingerprint: previous.baseFingerprint,
					baseRevision: previous.baseRevision,
				}
			: {}),
	});
}
export const resetWorkspaceStore = resetWorkspaceForResource;
