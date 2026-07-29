import type { StateCreator } from "zustand";
import { create } from "zustand";
import type {
	Account,
	EvaluationInstance,
	EvaluationResultStatus,
	EvaluationTables,
	EvaluationType,
	FinancialIndependencePlan,
	FinancialModelDocument,
	ModelOverrides,
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
					id: `comparison-${timestamp}`,
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
/*  Model overrides slice                                              */
/* ------------------------------------------------------------------ */

const initialModelOverrides: ModelOverrides = {
	addedAccounts: [],
	addedPostings: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

export interface ModelOverridesSlice extends ModelOverrides {
	addTemporaryAccount: (account: Account) => void;
	removeTemporaryAccount: (id: string) => void;
	addTemporaryPosting: (posting: Posting) => void;
	removeTemporaryPosting: (id: string) => void;
	toggleAccountDisabled: (id: string) => void;
	togglePostingDisabled: (id: string) => void;
	resetCurrentChanges: () => void;
}

const createModelOverridesSlice: StateCreator<
	AppStore,
	[],
	[],
	ModelOverridesSlice
> = (set) => ({
	...initialModelOverrides,

	addTemporaryAccount: (account) =>
		set((s) => ({ addedAccounts: [...s.addedAccounts, account] })),

	removeTemporaryAccount: (id) =>
		set((s) => ({ addedAccounts: s.addedAccounts.filter((a) => a.id !== id) })),

	addTemporaryPosting: (posting) =>
		set((s) => ({ addedPostings: [...s.addedPostings, posting] })),

	removeTemporaryPosting: (id) =>
		set((s) => ({ addedPostings: s.addedPostings.filter((p) => p.id !== id) })),

	toggleAccountDisabled: (id) =>
		set((s) => ({
			disabledAccountIds: s.disabledAccountIds.includes(id)
				? s.disabledAccountIds.filter((did) => did !== id)
				: [...s.disabledAccountIds, id],
		})),

	togglePostingDisabled: (id) =>
		set((s) => ({
			disabledPostingIds: s.disabledPostingIds.includes(id)
				? s.disabledPostingIds.filter((did) => did !== id)
				: [...s.disabledPostingIds, id],
		})),

	resetCurrentChanges: () => set(initialModelOverrides),
});

/* ------------------------------------------------------------------ */
/*  Editor slice                                                       */
/* ------------------------------------------------------------------ */

interface EditorSlice {
	workingDocument: FinancialModelDocument | null;
	isDirty: boolean;
	isEditing: boolean;
	startEditing: (document: FinancialModelDocument) => void;
	cancelEditing: () => void;
	updateAccount: (id: string, changes: Partial<Account>) => void;
	deleteAccount: (id: string) => void;
	addAccount: (account: Account) => void;
	updatePosting: (id: string, changes: Partial<Posting>) => void;
	deletePosting: (id: string) => void;
	addPosting: (posting: Posting) => void;
}

const createEditorSlice: StateCreator<AppStore, [], [], EditorSlice> = (
	set,
	_get,
) => ({
	workingDocument: null,
	isDirty: false,
	isEditing: false,

	startEditing: (document: FinancialModelDocument) => {
		set({
			workingDocument: cloneDocument(document),
			isDirty: false,
			isEditing: true,
		});
	},

	cancelEditing: () =>
		set({ workingDocument: null, isDirty: false, isEditing: false }),

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
});

/* ------------------------------------------------------------------ */
/*  Theme slice                                                        */
/* ------------------------------------------------------------------ */

type Theme = "light" | "dark" | "system";

function isTheme(value: string | null): value is Theme {
	return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): Theme {
	if (typeof window === "undefined") return "system";
	try {
		const storedTheme = window.localStorage?.getItem("theme") ?? null;
		return isTheme(storedTheme) ? storedTheme : "system";
	} catch {
		return "system";
	}
}

function resolveTheme(theme: Theme): "light" | "dark" {
	if (theme === "system") {
		if (
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function"
		) {
			return window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
		}
		return "light";
	}
	return theme;
}

function applyThemeToDOM(theme: Theme) {
	if (typeof window === "undefined") return;
	const resolved = resolveTheme(theme);
	document.documentElement.classList.toggle("dark", resolved === "dark");
	try {
		if (theme === "system") {
			window.localStorage?.removeItem("theme");
		} else {
			window.localStorage?.setItem("theme", theme);
		}
	} catch {
		// Storage can be unavailable even when window exists.
	}
}

interface ThemeSlice {
	theme: Theme;
	resolvedTheme: "light" | "dark";
	setTheme: (theme: Theme) => void;
}

const createThemeSlice: StateCreator<AppStore, [], [], ThemeSlice> = (set) => {
	const initial = readStoredTheme();
	return {
		theme: initial,
		resolvedTheme: resolveTheme(initial),
		setTheme: (theme) => {
			applyThemeToDOM(theme);
			set({ theme, resolvedTheme: resolveTheme(theme) });
		},
	};
};

/* ------------------------------------------------------------------ */
/*  Settings slice                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_STOCHASTIC_RUN_COUNT = 1000;

export const DEFAULT_FINANCIAL_INDEPENDENCE_PLAN: FinancialIndependencePlan = {
	minimumNetWorth: 1_500_000,
	annualExpenseTarget: 80_000,
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

export type AppStore = ModelOverridesSlice &
	EditorSlice &
	SettingsSlice &
	ComparisonSlice &
	ThemeSlice;

export const useStore = create<AppStore>()((...args) => ({
	...createModelOverridesSlice(...args),
	...createEditorSlice(...args),
	...createSettingsSlice(...args),
	...createComparisonSlice(...args),
	...createThemeSlice(...args),
}));

/* ------------------------------------------------------------------ */
/*  Selectors                                                          */
/* ------------------------------------------------------------------ */

export const selectCurrentChangeCount = (s: AppStore) =>
	s.addedAccounts.length +
	s.addedPostings.length +
	s.disabledAccountIds.length +
	s.disabledPostingIds.length;

export const selectModelOverrides = (s: AppStore): ModelOverrides => ({
	addedAccounts: s.addedAccounts,
	addedPostings: s.addedPostings,
	disabledAccountIds: s.disabledAccountIds,
	disabledPostingIds: s.disabledPostingIds,
});

export const selectEditorState = (s: AppStore) => ({
	isEditing: s.isEditing,
	isDirty: s.isDirty,
	workingDocument: s.workingDocument,
});

export const selectEditorActions = (s: AppStore) => ({
	startEditing: s.startEditing,
	cancelEditing: s.cancelEditing,
	updateAccount: s.updateAccount,
	deleteAccount: s.deleteAccount,
	addAccount: s.addAccount,
	updatePosting: s.updatePosting,
	deletePosting: s.deletePosting,
	addPosting: s.addPosting,
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function cloneDocument(
	document: FinancialModelDocument,
): FinancialModelDocument {
	return {
		...document,
		accounts: document.accounts.map((a) => ({ ...a })),
		postings: document.postings.map((p) => ({
			...p,
			destinations: p.destinations ? [...p.destinations] : null,
		})),
		evaluations: structuredClone(document.evaluations),
	};
}
