import type { StateCreator } from "zustand";
import { create } from "zustand";
import type {
	Account,
	Checkpoint,
	ConfiguredEvaluation,
	FinancialIndependencePlan,
	JsonValue,
	Posting,
	ScenarioPack,
	ScenarioWhatIfState,
	StochasticConfig,
} from "@/lib/projection";
import { isJsonValue } from "@/lib/projection";

/* ------------------------------------------------------------------ */
/*  Snapshot slice                                                     */
/* ------------------------------------------------------------------ */

export interface SnapshotMetrics {
	currentNetWorth: number;
	finalNetWorth: number;
	deterministicFiCycleDate: string | null;
	shortfallAmount: number;
	overrideCount: number;
}

export interface ScenarioSnapshot {
	id: string;
	label: string;
	timestamp: number;
	whatIfState: ScenarioWhatIfState;
	evaluations: ConfiguredEvaluation[];
	metrics: SnapshotMetrics;
}

export type StochasticPreference = "auto" | "enabled" | "disabled";

interface SnapshotSlice {
	snapshots: ScenarioSnapshot[];
	addSnapshotFromCurrentScenario: (
		label: string,
		metrics: SnapshotMetrics,
	) => void;
	removeSnapshot: (id: string) => void;
	clearSnapshots: () => void;
}

const createSnapshotSlice: StateCreator<AppStore, [], [], SnapshotSlice> = (
	set,
	get,
) => ({
	snapshots: [],
	addSnapshotFromCurrentScenario: (label, metrics) => {
		const state = get();
		const timestamp = Date.now();
		set({
			snapshots: [
				...state.snapshots,
				{
					id: `snap-${timestamp}`,
					label,
					timestamp,
					whatIfState: selectWhatIfState(state),
					evaluations: structuredClone(state.evaluations),
					metrics: { ...metrics },
				},
			],
		});
	},
	removeSnapshot: (id) =>
		set((s) => ({ snapshots: s.snapshots.filter((sn) => sn.id !== id) })),
	clearSnapshots: () => set({ snapshots: [] }),
});

/* ------------------------------------------------------------------ */
/*  What-if slice                                                      */
/* ------------------------------------------------------------------ */

const initialWhatIfState: ScenarioWhatIfState = {
	addedAccounts: [],
	addedPostings: [],
	addedCheckpoints: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

interface WhatIfSlice extends ScenarioWhatIfState {
	addTemporaryAccount: (account: Account) => void;
	removeTemporaryAccount: (id: string) => void;
	addTemporaryPosting: (posting: Posting) => void;
	removeTemporaryPosting: (id: string) => void;
	addTemporaryCheckpoint: (checkpoint: Checkpoint) => void;
	removeTemporaryCheckpoint: (index: number) => void;
	toggleAccountDisabled: (id: string) => void;
	togglePostingDisabled: (id: string) => void;
	resetAllOverrides: () => void;
}

const createWhatIfSlice: StateCreator<AppStore, [], [], WhatIfSlice> = (
	set,
) => ({
	...initialWhatIfState,

	addTemporaryAccount: (account) =>
		set((s) => ({ addedAccounts: [...s.addedAccounts, account] })),

	removeTemporaryAccount: (id) =>
		set((s) => ({ addedAccounts: s.addedAccounts.filter((a) => a.id !== id) })),

	addTemporaryPosting: (posting) =>
		set((s) => ({ addedPostings: [...s.addedPostings, posting] })),

	removeTemporaryPosting: (id) =>
		set((s) => ({ addedPostings: s.addedPostings.filter((p) => p.id !== id) })),

	addTemporaryCheckpoint: (checkpoint) =>
		set((s) => ({ addedCheckpoints: [...s.addedCheckpoints, checkpoint] })),

	removeTemporaryCheckpoint: (index) =>
		set((s) => ({
			addedCheckpoints: s.addedCheckpoints.filter((_, i) => i !== index),
		})),

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

	resetAllOverrides: () => set(initialWhatIfState),
});

/* ------------------------------------------------------------------ */
/*  Editor slice                                                       */
/* ------------------------------------------------------------------ */

interface EditorSlice {
	workingPack: ScenarioPack | null;
	isDirty: boolean;
	isEditing: boolean;
	startEditing: (pack: ScenarioPack) => void;
	cancelEditing: () => void;
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
	workingPack: null,
	isDirty: false,
	isEditing: false,

	startEditing: (pack: ScenarioPack) => {
		set({
			workingPack: clonePack(pack),
			isDirty: false,
			isEditing: true,
		});
	},

	cancelEditing: () =>
		set({ workingPack: null, isDirty: false, isEditing: false }),

	updateAccount: (id, changes) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					accounts: s.workingPack.accounts.map((a) =>
						a.id === id ? { ...a, ...changes } : a,
					),
				},
			};
		}),

	deleteAccount: (id) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					accounts: s.workingPack.accounts.filter((a) => a.id !== id),
				},
			};
		}),

	addAccount: (account) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					accounts: [...s.workingPack.accounts, account],
				},
			};
		}),

	updatePosting: (id, changes) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					postings: s.workingPack.postings.map((p) =>
						p.id === id ? { ...p, ...changes } : p,
					),
				},
			};
		}),

	deletePosting: (id) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					postings: s.workingPack.postings.filter((p) => p.id !== id),
				},
			};
		}),

	addPosting: (posting) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					postings: [...s.workingPack.postings, posting],
				},
			};
		}),

	addCheckpoint: (checkpoint) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					checkpoints: [...s.workingPack.checkpoints, checkpoint],
				},
			};
		}),

	deleteCheckpoint: (index) =>
		set((s) => {
			if (!s.workingPack) return s;
			return {
				isDirty: true,
				workingPack: {
					...s.workingPack,
					checkpoints: s.workingPack.checkpoints.filter((_, i) => i !== index),
				},
			};
		}),

	updateCheckpoint: (index, changes) =>
		set((s) => {
			if (!s.workingPack) return s;
			const next = [...s.workingPack.checkpoints];
			next[index] = { ...next[index], ...changes };
			return {
				isDirty: true,
				workingPack: { ...s.workingPack, checkpoints: next },
			};
		}),
});

/* ------------------------------------------------------------------ */
/*  Theme slice                                                        */
/* ------------------------------------------------------------------ */

type Theme = "light" | "dark" | "system";

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
	if (theme === "light") {
		localStorage.theme = "light";
	} else if (theme === "dark") {
		localStorage.theme = "dark";
	} else {
		localStorage.removeItem("theme");
	}
}

interface ThemeSlice {
	theme: Theme;
	resolvedTheme: "light" | "dark";
	setTheme: (theme: Theme) => void;
}

const createThemeSlice: StateCreator<AppStore, [], [], ThemeSlice> = (set) => {
	const initial =
		typeof window !== "undefined"
			? (localStorage.theme as Theme | undefined)
			: undefined;
	return {
		theme: initial ?? "system",
		resolvedTheme: resolveTheme(initial ?? "system"),
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

export const DEFAULT_EVALUATIONS: ConfiguredEvaluation[] = [
	{
		definitionId: "financial-independence",
		instanceId: "financial-independence",
		label: "Financial independence",
		enabled: true,
		config: structuredClone(
			DEFAULT_FINANCIAL_INDEPENDENCE_PLAN,
		) as unknown as JsonValue,
	},
	{
		definitionId: "net-worth-threshold",
		instanceId: "net-worth-1m",
		label: "Reach $1,000,000 net worth",
		enabled: true,
		config: { target: 1_000_000 },
	},
];

interface SettingsSlice {
	evaluations: ConfiguredEvaluation[];
	addEvaluation: (evaluation: ConfiguredEvaluation) => void;
	duplicateEvaluation: (instanceId: string) => void;
	updateEvaluation: (
		instanceId: string,
		changes: Partial<ConfiguredEvaluation>,
	) => void;
	updateEvaluationConfig: (instanceId: string, changes: object) => void;
	removeEvaluation: (instanceId: string) => void;
	moveEvaluation: (instanceId: string, direction: -1 | 1) => void;
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
	addEvaluation: (evaluation) =>
		set((state) =>
			!evaluation.instanceId.trim() ||
			!isJsonValue(evaluation.config) ||
			state.evaluations.some(
				(item) => item.instanceId === evaluation.instanceId,
			)
				? state
				: { evaluations: [...state.evaluations, evaluation] },
		),
	duplicateEvaluation: (instanceId) =>
		set((state) => {
			const source = state.evaluations.find(
				(evaluation) => evaluation.instanceId === instanceId,
			);
			if (!source) return state;
			let suffix = 2;
			let nextId = `${source.instanceId}-${suffix}`;
			while (state.evaluations.some((item) => item.instanceId === nextId)) {
				suffix++;
				nextId = `${source.instanceId}-${suffix}`;
			}
			return {
				evaluations: [
					...state.evaluations,
					{
						...structuredClone(source),
						instanceId: nextId,
						label: `${source.label} copy`,
					},
				],
			};
		}),
	updateEvaluation: (instanceId, changes) =>
		set((state) => {
			if (
				(changes.config !== undefined && !isJsonValue(changes.config)) ||
				(changes.instanceId !== undefined &&
					(changes.instanceId.trim() === "" ||
						state.evaluations.some(
							(item) =>
								item.instanceId === changes.instanceId &&
								item.instanceId !== instanceId,
						)))
			) {
				return state;
			}
			return {
				evaluations: state.evaluations.map((evaluation) =>
					evaluation.instanceId === instanceId
						? { ...evaluation, ...changes }
						: evaluation,
				),
			};
		}),
	updateEvaluationConfig: (instanceId, changes) =>
		set((state) =>
			!isJsonValue(changes) || Array.isArray(changes)
				? state
				: {
						evaluations: state.evaluations.map((evaluation) =>
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
		),
	removeEvaluation: (instanceId) =>
		set((state) => ({
			evaluations: state.evaluations.filter(
				(evaluation) => evaluation.instanceId !== instanceId,
			),
		})),
	moveEvaluation: (instanceId, direction) =>
		set((state) => {
			const index = state.evaluations.findIndex(
				(evaluation) => evaluation.instanceId === instanceId,
			);
			const destination = index + direction;
			if (
				index < 0 ||
				destination < 0 ||
				destination >= state.evaluations.length
			) {
				return state;
			}
			const evaluations = [...state.evaluations];
			[evaluations[index], evaluations[destination]] = [
				evaluations[destination],
				evaluations[index],
			];
			return { evaluations };
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

export type AppStore = WhatIfSlice &
	EditorSlice &
	SettingsSlice &
	SnapshotSlice &
	ThemeSlice;

export const useStore = create<AppStore>()((...args) => ({
	...createWhatIfSlice(...args),
	...createEditorSlice(...args),
	...createSettingsSlice(...args),
	...createSnapshotSlice(...args),
	...createThemeSlice(...args),
}));

/* ------------------------------------------------------------------ */
/*  Selectors                                                          */
/* ------------------------------------------------------------------ */

export const selectActiveOverrideCount = (s: AppStore) =>
	s.addedAccounts.length +
	s.addedPostings.length +
	s.addedCheckpoints.length +
	s.disabledAccountIds.length +
	s.disabledPostingIds.length;

export const selectWhatIfState = (s: AppStore): ScenarioWhatIfState => ({
	addedAccounts: s.addedAccounts,
	addedPostings: s.addedPostings,
	addedCheckpoints: s.addedCheckpoints,
	disabledAccountIds: s.disabledAccountIds,
	disabledPostingIds: s.disabledPostingIds,
});

export const selectEditorState = (s: AppStore) => ({
	isEditing: s.isEditing,
	isDirty: s.isDirty,
	workingPack: s.workingPack,
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
	addCheckpoint: s.addCheckpoint,
	deleteCheckpoint: s.deleteCheckpoint,
	updateCheckpoint: s.updateCheckpoint,
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function clonePack(pack: ScenarioPack): ScenarioPack {
	return {
		...pack,
		accounts: pack.accounts.map((a) => ({ ...a })),
		checkpoints: pack.checkpoints.map((c) => ({ ...c })),
		postings: pack.postings.map((p) => ({
			...p,
			destinations: p.destinations ? [...p.destinations] : null,
		})),
	};
}
