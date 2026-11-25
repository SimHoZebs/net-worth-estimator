import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import type { SafeSpendingSettingsUpdate } from "@/state/useSafeSpendingSettings.ts";
import {
	resolveSafeSpendingSelections,
	useSafeSpendingSelections,
} from "./useSafeSpendingSelections.ts";
import {
	applySafeSpendingNumericInputs,
	changedIds,
	dirtySafeSpendingNumericFields,
	safeSpendingNumericInputs,
	sameIds,
	sameSafeSpendingSettings,
	type SafeSpendingNumericInputs,
	type SafeSpendingNumericKey,
} from "./safeSpendingDraft.ts";

const ignoreSettingsUpdate = () => {};

type DraftState = {
	baseline: SafeSpendingSettings;
	draft: SafeSpendingSettings;
	inputOverrides: Partial<Record<SafeSpendingNumericKey, string>>;
	adoptedSettings: SafeSpendingSettings;
	failedSettingsRevision: number | null;
};

const emptyInputOverrides: Partial<Record<SafeSpendingNumericKey, string>> = {};

function numericInputsOf(
	draft: SafeSpendingSettings,
	overrides: Partial<Record<SafeSpendingNumericKey, string>>,
): SafeSpendingNumericInputs {
	const values = safeSpendingNumericInputs(draft);
	for (const key of Object.keys(overrides) as SafeSpendingNumericKey[])
		values[key] = overrides[key] ?? values[key];
	return values;
}

function numericInputsAreComplete(inputs: SafeSpendingNumericInputs): boolean {
	return Object.values(inputs).every((value) => {
		if (value.trim() === "") return false;
		return Number.isFinite(Number(value));
	});
}

function selectionsDiffer(
	baseline: SafeSpendingSettings,
	draft: SafeSpendingSettings,
	accounts: Account[],
	rules: Transaction[],
	savedRules: Schedule[],
	displayToday: string,
): boolean {
	const input = { accounts, rules, savedRules, displayToday };
	const saved = resolveSafeSpendingSelections({ ...input, settings: baseline });
	const staged = resolveSafeSpendingSelections({ ...input, settings: draft });
	return (
		!sameIds(saved.trackedIds, staged.trackedIds) ||
		!sameIds(saved.spendingIds, staged.spendingIds) ||
		!sameIds(baseline.incomeScheduleIds, draft.incomeScheduleIds) ||
		!sameIds(saved.trackedBillIds, staged.trackedBillIds)
	);
}

/**
 * Owns one open detail view's configuration draft. The persisted settings hook
 * remains the saved/optimistic source for the preview and transaction evidence.
 */
export function useSafeSpendingDraft({
	settings,
	settingsMutating,
	settingsRevision,
	updateSettings,
	accounts,
	rules,
	savedRules,
	displayToday,
}: {
	settings: SafeSpendingSettings;
	settingsMutating: boolean;
	settingsRevision: number;
	updateSettings: SafeSpendingSettingsUpdate;
	accounts: Account[];
	rules: Transaction[];
	savedRules: Schedule[];
	displayToday: string;
}) {
	const [state, setState] = useState<DraftState>(() => ({
		baseline: structuredClone(settings),
		draft: structuredClone(settings),
		inputOverrides: emptyInputOverrides,
		adoptedSettings: settings,
		failedSettingsRevision: null,
	}));
	const [saving, setSaving] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);
	const savingRef = useRef(false);
	const settingsRevisionRef = useRef(settingsRevision);
	useEffect(() => {
		settingsRevisionRef.current = settingsRevision;
	}, [settingsRevision]);

	const stateNumericInputs = useMemo(
		() => numericInputsOf(state.draft, state.inputOverrides),
		[state.draft, state.inputOverrides],
	);
	const stateNumericDirty = useMemo(
		() => dirtySafeSpendingNumericFields(state.baseline, stateNumericInputs),
		[state.baseline, stateNumericInputs],
	);
	const stagedSettings = useMemo(
		() =>
			numericInputsAreComplete(stateNumericInputs)
				? applySafeSpendingNumericInputs(state.draft, stateNumericInputs)
				: undefined,
		[state.draft, stateNumericInputs],
	);
	const stateSelectionsDirty = useMemo(
		() =>
			selectionsDiffer(
				state.baseline,
				state.draft,
				accounts,
				rules,
				savedRules,
				displayToday,
			),
		[state.baseline, state.draft, accounts, rules, savedRules, displayToday],
	);
	const stateDirty =
		Object.values(stateNumericDirty).some(Boolean) || stateSelectionsDirty;
	const savedSettingsChanged = !sameSafeSpendingSettings(
		state.adoptedSettings,
		settings,
	);
	const savedMatchesDraft =
		stagedSettings !== undefined &&
		sameSafeSpendingSettings(settings, stagedSettings);
	const recoveringFailedSave =
		saveFailed &&
		state.failedSettingsRevision !== null &&
		settingsRevision === state.failedSettingsRevision;
	const adopting =
		!saving &&
		!settingsMutating &&
		!recoveringFailedSave &&
		savedSettingsChanged &&
		(!stateDirty || savedMatchesDraft);
	const baseline = adopting ? settings : state.baseline;
	const draft = adopting ? settings : state.draft;
	const inputOverrides = adopting ? emptyInputOverrides : state.inputOverrides;

	useEffect(() => {
		if (!adopting) return;
		// Commit the adopted server snapshot so a later external update cannot
		// expose stale draft state that only looked clean for one render.
		// oxlint-disable-next-line react/set-state-in-effect
		setState({
			baseline: structuredClone(settings),
			draft: structuredClone(settings),
			inputOverrides: emptyInputOverrides,
			adoptedSettings: settings,
			failedSettingsRevision: null,
		});
		// oxlint-disable-next-line react/set-state-in-effect
		setSaveFailed(false);
	}, [adopting, settings]);

	const updateDraftSettings = useCallback(
		(next: Partial<SafeSpendingSettings>) => {
			setSaveFailed(false);
			setState((previous) => ({
				baseline: adopting ? structuredClone(settings) : previous.baseline,
				draft: {
					...(adopting ? settings : previous.draft),
					...next,
				},
				inputOverrides: adopting ? {} : previous.inputOverrides,
				adoptedSettings: adopting ? settings : previous.adoptedSettings,
				failedSettingsRevision: null,
			}));
		},
		[adopting, settings],
	);

	const baselineSelections = useSafeSpendingSelections({
		accounts,
		rules,
		savedRules,
		settings: baseline,
		displayToday,
		updateSettings: ignoreSettingsUpdate,
	});
	const selections = useSafeSpendingSelections({
		accounts,
		rules,
		savedRules,
		settings: draft,
		displayToday,
		updateSettings: updateDraftSettings,
	});

	const numericInputs = useMemo(
		() => numericInputsOf(draft, inputOverrides),
		[draft, inputOverrides],
	);
	const dirtyNumericFields = useMemo(
		() => dirtySafeSpendingNumericFields(baseline, numericInputs),
		[baseline, numericInputs],
	);
	const dirtyTrackedIds = useMemo(
		() => changedIds(baselineSelections.trackedIds, selections.trackedIds),
		[baselineSelections.trackedIds, selections.trackedIds],
	);
	const dirtySpendingIds = useMemo(
		() => changedIds(baselineSelections.spendingIds, selections.spendingIds),
		[baselineSelections.spendingIds, selections.spendingIds],
	);
	const dirtyIncomeIds = useMemo(
		() => changedIds(baseline.incomeScheduleIds, draft.incomeScheduleIds),
		[baseline.incomeScheduleIds, draft.incomeScheduleIds],
	);
	const dirtyBillIds = useMemo(
		() =>
			changedIds(baselineSelections.trackedBillIds, selections.trackedBillIds),
		[baselineSelections.trackedBillIds, selections.trackedBillIds],
	);
	const dirty =
		Object.values(dirtyNumericFields).some(Boolean) ||
		!sameIds(baselineSelections.trackedIds, selections.trackedIds) ||
		!sameIds(baselineSelections.spendingIds, selections.spendingIds) ||
		!sameIds(baseline.incomeScheduleIds, draft.incomeScheduleIds) ||
		!sameIds(baselineSelections.trackedBillIds, selections.trackedBillIds);

	const setNumericValue = useCallback(
		(key: SafeSpendingNumericKey, value: string) => {
			setSaveFailed(false);
			setState((previous) => ({
				baseline: adopting ? structuredClone(settings) : previous.baseline,
				draft: adopting ? structuredClone(settings) : previous.draft,
				inputOverrides: {
					...(adopting ? {} : previous.inputOverrides),
					[key]: value,
				},
				adoptedSettings: adopting ? settings : previous.adoptedSettings,
				failedSettingsRevision: null,
			}));
		},
		[adopting, settings],
	);

	const save = useCallback(async () => {
		if (!dirty || savingRef.current) return;
		savingRef.current = true;
		setSaving(true);
		setSaveFailed(false);
		setState((previous) => ({
			...previous,
			failedSettingsRevision: null,
		}));
		const next = applySafeSpendingNumericInputs(draft, numericInputs);
		try {
			const pending = updateSettings(next, { retry: false });
			if (!pending) throw new Error("Budget settings are not ready.");
			const result = await pending;
			if (result === null) throw new Error("Budget settings were not saved.");
			setState({
				baseline: structuredClone(next),
				draft: structuredClone(next),
				inputOverrides: {},
				adoptedSettings: next,
				failedSettingsRevision: null,
			});
		} catch {
			setSaveFailed(true);
			setState((previous) => ({
				...previous,
				failedSettingsRevision: settingsRevisionRef.current,
			}));
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}, [dirty, draft, numericInputs, updateSettings]);

	return {
		baseline,
		draft,
		selections,
		numericInputs,
		dirtyNumericFields,
		dirtyTrackedIds,
		dirtySpendingIds,
		dirtyIncomeIds,
		dirtyBillIds,
		dirty,
		saving,
		saveFailed: adopting ? false : saveFailed,
		setNumericValue,
		updateDraftSettings,
		save,
	};
}
