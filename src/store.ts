import type { StateCreator } from "zustand";
import { create } from "zustand";
import type {
	Account,
	Checkpoint,
	EvaluationInstance,
	EvaluationResultStatus,
	EvaluationTables,
	EvaluationType,
	FinancialIndependencePlan,
	FinancialModelDocument,
	Posting,
	StochasticConfig,
} from "@/lib/projection";
import { isJsonValue } from "@/lib/projection";

/* ------------------------------------------------------------------ */
/*  Comparison slice                                                   */
/* ------------------------------------------------------------------ */

export interface ComparisonMetrics {
	currentNetWorth: number;
	finalNetWorth: number;
	evaluationOutcomes: Array<{
		instanceId: string;
		label: string;
		status: EvaluationResultStatus;
	}>;
	currentChangeCount: number;
}

export interface ComparisonSnapshot {
	id: string;
	label: string;
	timestamp: number;
	metrics: ComparisonMetrics;
}

export type StochasticPreference = "auto" | "enabled" | "disabled";

interface ComparisonSlice {
	comparisonSnapshots: ComparisonSnapshot[];
	captureCurrentComparison: (label: string, metrics: ComparisonMetrics) => void;
	removeComparison: (id: string) => void;
	clearComparisons: () => void;
}

const createComparisonSlice: StateCreator<AppStore, [], [], ComparisonSlice> = (
	set,
) => ({
	comparisonSnapshots: [],
	captureCurrentComparison: (label, metrics) => {
		const timestamp = Date.now();
		set((state) => ({
			comparisonSnapshots: [
				...state.comparisonSnapshots,
				{
					id: `comparison-${crypto.randomUUID()}`,
					label,
					timestamp,
					metrics: structuredClone(metrics),
				},
			],
		}));
	},
	removeComparison: (id) =>
		set((s) => ({
			comparisonSnapshots: s.comparisonSnapshots.filter(
				(snapshot) => snapshot.id !== id,
			),
		})),
	clearComparisons: () => set({ comparisonSnapshots: [] }),
});

/* ------------------------------------------------------------------ */
/*  Editor slice                                                       */
/* ------------------------------------------------------------------ */

interface EditorSlice {
	workingDocument: FinancialModelDocument | null;
	editingBaseline: FinancialModelDocument | null;
	isDirty: boolean;
	isEditing: boolean;
	startEditing: (document: FinancialModelDocument) => void;
	cancelEditing: () => void;
	finishEditing: () => void;
	updateAccount: (id: string, changes: Partial<Account>) => void;
	deleteAccount: (id: string) => void;
	addAccount: (account: Account) => void;
	updatePosting: (id: string, changes: Partial<Posting>) => void;
	deletePosting: (id: string) => void;
	addPosting: (posting: Posting) => void;
	addCheckpoint: (checkpoint: Checkpoint) => void;
	deleteCheckpoint: (index: number) => void;
	updateCheckpoint: (index: number, changes: Partial<Checkpoint>) => void;
}

const createEditorSlice: StateCreator<AppStore, [], [], EditorSlice> = (
	set,
	_get,
) => ({
	workingDocument: null,
	editingBaseline: null,
	isDirty: false,
	isEditing: false,

	startEditing: (document: FinancialModelDocument) => {
		set({
			workingDocument: cloneDocument(document),
			editingBaseline: cloneDocument(document),
			isDirty: false,
			isEditing: true,
		});
	},

	cancelEditing: () =>
		set({
			workingDocument: null,
			editingBaseline: null,
			isDirty: false,
			isEditing: false,
		}),

	finishEditing: () =>
		set({
			workingDocument: null,
			editingBaseline: null,
			isDirty: false,
			isEditing: false,
		}),

	updateAccount: (id, changes) =>
		set((s) => {
			if (!s.workingDocument) return s;
			return {
				isDirty: true,
				workingDocument: {
					...s.workingDocument,
					accounts: s.workingDocument.accounts.map((a) =>
						a.id === id ? { ...a, ...changes } : a,
					),
				},
			};
		}),

	deleteAccount: (id) =>
		set((s) => {
			if (!s.workingDocument) return s;
			return {
				isDirty: true,
				workingDocument: {
					...s.workingDocument,
					accounts: s.workingDocument.accounts.filter((a) => a.id !== id),
				},
			};
		}),

	addAccount: (account) =>
		set((s) => {
			if (!s.workingDocument) return s;
			return {
				isDirty: true,
				workingDocument: {
					...s.workingDocument,
					accounts: [...s.workingDocument.accounts, account],
				},
			};
		}),

	updatePosting: (id, changes) =>
		set((s) => {
			if (!s.workingDocument) return s;
			return {
				isDirty: true,
				workingDocument: {
					...s.workingDocument,
					postings: s.workingDocument.postings.map((p) =>
						p.id === id ? { ...p, ...changes } : p,
					),
				},
			};
		}),

	deletePosting: (id) =>
		set((s) => {
			if (!s.workingDocument) return s;
			return {
				isDirty: true,
				workingDocument: {
					...s.workingDocument,
					postings: s.workingDocument.postings.filter((p) => p.id !== id),
				},
			};
		}),

	addPosting: (posting) =>
		set((s) => {
			if (!s.workingDocument) return s;
			return {
				isDirty: true,
				workingDocument: {
					...s.workingDocument,
					postings: [...s.workingDocument.postings, posting],
				},
			};
		}),

	addCheckpoint: (checkpoint) =>
		set((state) => {
			if (!state.workingDocument) return state;
			return {
				isDirty: true,
				workingDocument: {
					...state.workingDocument,
					checkpoints: [...state.workingDocument.checkpoints, checkpoint],
				},
			};
		}),

	deleteCheckpoint: (index) =>
		set((state) => {
			if (!state.workingDocument) return state;
			return {
				isDirty: true,
				workingDocument: {
					...state.workingDocument,
					checkpoints: state.workingDocument.checkpoints.filter(
						(_, checkpointIndex) => checkpointIndex !== index,
					),
				},
			};
		}),

	updateCheckpoint: (index, changes) =>
		set((state) => {
			if (!state.workingDocument) return state;
			const checkpoints = [...state.workingDocument.checkpoints];
			const checkpoint = checkpoints[index];
			if (!checkpoint) return state;
			checkpoints[index] = { ...checkpoint, ...changes };
			return {
				isDirty: true,
				workingDocument: { ...state.workingDocument, checkpoints },
			};
		}),
});

/* ------------------------------------------------------------------ */
/*  Settings slice                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_STOCHASTIC_RUN_COUNT = 1000;

export const DEFAULT_FINANCIAL_INDEPENDENCE_PLAN: FinancialIndependencePlan = {
	minimumNetWorth: 1_500_000,
	annualExpenseTarget: 80_000,
	annualExpenseTargetBasis: "fi-date-dollars",
	annualExpenseGrowthRate: 0.025,
	withdrawalRate: 0.04,
	evaluationYears: 10,
	requiredConfidence: 0.9,
	sources: [],
	continuingPostingIds: [],
	principalPolicy: "preserve-real-principal",
};

export const DEFAULT_EVALUATIONS: EvaluationTables = {
	financialIndependence: [
		{
			instanceId: "financial-independence",
			label: "Financial independence",
			enabled: true,
			config: structuredClone(DEFAULT_FINANCIAL_INDEPENDENCE_PLAN),
		},
	],
	netWorthThreshold: [
		{
			instanceId: "net-worth-1m",
			label: "Reach $1,000,000 net worth",
			enabled: true,
			config: { target: 1_000_000 },
		},
	],
	postingFulfillment: [
		{
			instanceId: "posting-fulfillment",
			label: "Posting fulfillment",
			enabled: true,
			config: { postingIds: null },
		},
	],
};

function evaluationTable(
	evaluations: EvaluationTables,
	type: EvaluationType,
): EvaluationInstance<unknown>[] {
	return evaluations[type] as EvaluationInstance<unknown>[];
}

function hasEvaluationInstanceId(
	evaluations: EvaluationTables,
	instanceId: string,
	excludeInstanceId?: string,
) {
	return (Object.values(evaluations) as EvaluationInstance<unknown>[][]).some(
		(table) =>
			table.some(
				(evaluation) =>
					evaluation.instanceId === instanceId &&
					evaluation.instanceId !== excludeInstanceId,
			),
	);
}

interface SettingsSlice {
	evaluations: EvaluationTables;
	replaceEvaluations: (evaluations: EvaluationTables) => void;
	addEvaluation: (
		type: EvaluationType,
		evaluation: EvaluationInstance<unknown>,
	) => void;
	duplicateEvaluation: (type: EvaluationType, instanceId: string) => void;
	updateEvaluation: (
		type: EvaluationType,
		instanceId: string,
		changes: Partial<EvaluationInstance<unknown>>,
	) => void;
	updateEvaluationConfig: (
		type: EvaluationType,
		instanceId: string,
		changes: object,
	) => void;
	removeEvaluation: (type: EvaluationType, instanceId: string) => void;
	moveEvaluation: (
		type: EvaluationType,
		instanceId: string,
		direction: -1 | 1,
	) => void;
	horizonYears: number;
	setHorizonYears: (years: number) => void;
	stochasticPreference: StochasticPreference;
	setStochasticPreference: (preference: StochasticPreference) => void;
	stochasticConfig: StochasticConfig;
	setStochasticConfig: (config: StochasticConfig) => void;
}

const DEFAULT_HORIZON_YEARS = 15;

const createSettingsSlice: StateCreator<AppStore, [], [], SettingsSlice> = (
	set,
) => ({
	// Seeded defaults: component tests and pre-load renders expect usable
	// evaluation tables. App replaces these from the loaded document keyed
	// by data timestamp (see App.tsx), so session edits survive re-renders.
	evaluations: structuredClone(DEFAULT_EVALUATIONS),
	replaceEvaluations: (evaluations) =>
		set({ evaluations: structuredClone(evaluations) }),
	addEvaluation: (type, evaluation) =>
		set((state) =>
			!evaluation.instanceId.trim() ||
			!isJsonValue(evaluation.config) ||
			hasEvaluationInstanceId(state.evaluations, evaluation.instanceId)
				? state
				: {
						evaluations: {
							...state.evaluations,
							[type]: [...evaluationTable(state.evaluations, type), evaluation],
						},
					},
		),
	duplicateEvaluation: (type, instanceId) =>
		set((state) => {
			const table = evaluationTable(state.evaluations, type);
			const sourceIndex = table.findIndex(
				(evaluation) => evaluation.instanceId === instanceId,
			);
			const source = table[sourceIndex];
			if (!source) return state;
			let suffix = 2;
			let nextId = `${source.instanceId}-${suffix}`;
			while (hasEvaluationInstanceId(state.evaluations, nextId)) {
				suffix++;
				nextId = `${source.instanceId}-${suffix}`;
			}
			const nextTable = [...table];
			nextTable.splice(sourceIndex + 1, 0, {
				...structuredClone(source),
				instanceId: nextId,
				label: `${source.label} copy`,
			});
			return {
				evaluations: { ...state.evaluations, [type]: nextTable },
			};
		}),
	updateEvaluation: (type, instanceId, changes) =>
		set((state) => {
			if (
				(changes.config !== undefined && !isJsonValue(changes.config)) ||
				(changes.instanceId !== undefined &&
					(changes.instanceId.trim() === "" ||
						hasEvaluationInstanceId(
							state.evaluations,
							changes.instanceId,
							instanceId,
						)))
			) {
				return state;
			}
			return {
				evaluations: {
					...state.evaluations,
					[type]: evaluationTable(state.evaluations, type).map((evaluation) =>
						evaluation.instanceId === instanceId
							? { ...evaluation, ...changes }
							: evaluation,
					),
				},
			};
		}),
	updateEvaluationConfig: (type, instanceId, changes) =>
		set((state) =>
			!isJsonValue(changes) || Array.isArray(changes)
				? state
				: {
						evaluations: {
							...state.evaluations,
							[type]: evaluationTable(state.evaluations, type).map(
								(evaluation) =>
									evaluation.instanceId === instanceId
										? {
												...evaluation,
												config: {
													...(typeof evaluation.config === "object" &&
													evaluation.config !== null &&
													!Array.isArray(evaluation.config)
														? evaluation.config
														: {}),
													...changes,
												},
											}
										: evaluation,
							),
						},
					},
		),
	removeEvaluation: (type, instanceId) =>
		set((state) => ({
			evaluations: {
				...state.evaluations,
				[type]: evaluationTable(state.evaluations, type).filter(
					(evaluation) => evaluation.instanceId !== instanceId,
				),
			},
		})),
	moveEvaluation: (type, instanceId, direction) =>
		set((state) => {
			const table = evaluationTable(state.evaluations, type);
			const index = table.findIndex(
				(evaluation) => evaluation.instanceId === instanceId,
			);
			const destination = index + direction;
			if (index < 0 || destination < 0 || destination >= table.length) {
				return state;
			}
			const nextTable = [...table];
			[nextTable[index], nextTable[destination]] = [
				nextTable[destination],
				nextTable[index],
			];
			return { evaluations: { ...state.evaluations, [type]: nextTable } };
		}),

	horizonYears: DEFAULT_HORIZON_YEARS,
	setHorizonYears: (years) => set({ horizonYears: years }),

	stochasticPreference: "auto",
	setStochasticPreference: (preference) =>
		set({ stochasticPreference: preference }),

	stochasticConfig: { runCount: DEFAULT_STOCHASTIC_RUN_COUNT, seed: null },
	setStochasticConfig: (config) => set({ stochasticConfig: config }),
});

/* ------------------------------------------------------------------ */
/*  Composed store                                                     */
/* ------------------------------------------------------------------ */

export type AppStore = EditorSlice & SettingsSlice & ComparisonSlice;

export const useStore = create<AppStore>()((...args) => ({
	...createEditorSlice(...args),
	...createSettingsSlice(...args),
	...createComparisonSlice(...args),
}));

/* ------------------------------------------------------------------ */
/*  Selectors                                                          */
/* ------------------------------------------------------------------ */

export const selectCurrentChangeCount = (s: AppStore) =>
	s.workingDocument && s.editingBaseline
		? countDocumentDiff(s.editingBaseline, s.workingDocument)
		: 0;

// Stable atomic selectors. Prefer these (or wrap the composites below in
// useShallow): each returns a stable reference instead of a fresh object.
export const selectIsEditing = (s: AppStore) => s.isEditing;
export const selectIsDirty = (s: AppStore) => s.isDirty;
export const selectWorkingDocument = (s: AppStore) => s.workingDocument;
export const selectEditingBaseline = (s: AppStore) => s.editingBaseline;
export const selectStartEditing = (s: AppStore) => s.startEditing;
export const selectCancelEditing = (s: AppStore) => s.cancelEditing;
export const selectFinishEditing = (s: AppStore) => s.finishEditing;

export const selectEditorState = (s: AppStore) => ({
	isEditing: selectIsEditing(s),
	isDirty: selectIsDirty(s),
	workingDocument: selectWorkingDocument(s),
	editingBaseline: selectEditingBaseline(s),
});

export const selectEditorActions = (s: AppStore) => ({
	startEditing: s.startEditing,
	cancelEditing: s.cancelEditing,
	finishEditing: s.finishEditing,
	updateAccount: s.updateAccount,
	deleteAccount: s.deleteAccount,
	addAccount: s.addAccount,
	updatePosting: s.updatePosting,
	deletePosting: s.deletePosting,
	addPosting: s.addPosting,
	addCheckpoint: s.addCheckpoint,
	deleteCheckpoint: s.deleteCheckpoint,
	updateCheckpoint: s.updateCheckpoint,
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Unsaved-diff count between the canonical baseline captured at
 * `startEditing` and the live draft: added + removed + modified rows
 * across accounts, postings, and checkpoints. Checkpoints carry no stable
 * ID, so they compare positionally.
 */
export function countDocumentDiff(
	baseline: FinancialModelDocument,
	draft: FinancialModelDocument,
): number {
	return (
		countKeyedRowDiff(
			baseline.accounts,
			draft.accounts,
			(account) => account.id,
		) +
		countKeyedRowDiff(
			baseline.postings,
			draft.postings,
			(posting) => posting.id,
		) +
		countPositionalRowDiff(baseline.checkpoints, draft.checkpoints)
	);
}

function isJsonEqual(current: unknown, original: unknown): boolean {
	return JSON.stringify(current) === JSON.stringify(original);
}

function countKeyedRowDiff<T>(
	baseline: T[],
	draft: T[],
	getId: (row: T) => string,
): number {
	const originals = new Map(baseline.map((row) => [getId(row), row]));
	const draftIds = new Set(draft.map((row) => getId(row)));
	let count = 0;
	for (const row of draft) {
		const original = originals.get(getId(row));
		if (original === undefined || !isJsonEqual(row, original)) count += 1;
	}
	for (const row of baseline) {
		if (!draftIds.has(getId(row))) count += 1;
	}
	return count;
}

function countPositionalRowDiff<T>(baseline: T[], draft: T[]): number {
	let count = 0;
	const rowCount = Math.max(baseline.length, draft.length);
	for (let index = 0; index < rowCount; index++) {
		const original = baseline[index];
		const current = draft[index];
		if (
			original === undefined ||
			current === undefined ||
			!isJsonEqual(current, original)
		) {
			count += 1;
		}
	}
	return count;
}

export function cloneDocument(
	document: FinancialModelDocument,
): FinancialModelDocument {
	return {
		...document,
		accounts: document.accounts.map((a) => ({ ...a })),
		checkpoints: document.checkpoints.map((checkpoint) => ({ ...checkpoint })),
		postings: document.postings.map((p) => ({
			...p,
			destinations: p.destinations ? [...p.destinations] : null,
		})),
		evaluations: structuredClone(document.evaluations),
	};
}
