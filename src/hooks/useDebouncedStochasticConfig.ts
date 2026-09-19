import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StochasticConfig } from "@/lib/projection";
import { normalizeStochasticConfig } from "@/lib/projection/utils/stochastic";
import { useDebouncedValue } from "./useDebouncedValue";

const DEBOUNCE_MS = 2000;

function parseRunCount(value: string): number | null {
	if (value.trim() === "") return null;
	const runCount = Number(value);
	return Number.isFinite(runCount) ? runCount : null;
}

function parseSeed(value: string): number | null | undefined {
	if (value.trim() === "") return null;
	const seed = Number(value);
	return Number.isFinite(seed) ? seed : undefined;
}

function displaySeed(seed: number | null): string {
	return seed !== null ? String(seed) : "";
}

export function useDebouncedStochasticConfig(
	config: StochasticConfig,
	onConfigChange: (config: StochasticConfig) => void,
) {
	const [runCountText, setRunCountText] = useState(String(config.runCount));
	const [seedText, setSeedText] = useState(displaySeed(config.seed));
	const [dirtyFields, setDirtyFields] = useState({
		runCount: false,
		seed: false,
	});

	const configRef = useRef(config);
	configRef.current = config;
	const onConfigChangeRef = useRef(onConfigChange);
	onConfigChangeRef.current = onConfigChange;

	// Rebase untouched fields onto external config changes so a pending edit
	// in one field never clobbers a newer controlled value in the other.
	useEffect(() => {
		const runDisplay = String(config.runCount);
		const seedDisplay = displaySeed(config.seed);
		if (!dirtyFields.runCount && runCountText !== runDisplay) {
			setRunCountText(runDisplay);
		}
		if (!dirtyFields.seed && seedText !== seedDisplay) {
			setSeedText(seedDisplay);
		}
		if (dirtyFields.runCount && runCountText === runDisplay) {
			setDirtyFields((dirty) =>
				dirty.runCount ? { ...dirty, runCount: false } : dirty,
			);
		}
		if (dirtyFields.seed && seedText === seedDisplay) {
			setDirtyFields((dirty) =>
				dirty.seed ? { ...dirty, seed: false } : dirty,
			);
		}
	}, [config, dirtyFields, runCountText, seedText]);

	const commitTexts = useCallback((runText: string, seedTextValue: string) => {
		const base = configRef.current;
		const next = { ...base };
		let changed = false;

		const runCount = parseRunCount(runText);
		if (runCount !== null) {
			const normalized = normalizeStochasticConfig({
				runCount,
				seed: null,
			}).runCount;
			if (normalized !== base.runCount) {
				next.runCount = normalized;
				changed = true;
			}
		} else {
			setRunCountText(String(configRef.current.runCount));
		}

		const seed = parseSeed(seedTextValue);
		if (seed !== undefined) {
			if (seed !== base.seed) {
				next.seed = seed;
				changed = true;
			}
		} else {
			setSeedText(displaySeed(configRef.current.seed));
		}

		// Committed fields match the controlled config and reverted fields
		// are rewritten from it, so nothing stays dirty. Idempotent: when the
		// debounce settles after an explicit apply, the diff guard below
		// skips the duplicate commit.
		setDirtyFields({ runCount: false, seed: false });
		if (changed) onConfigChangeRef.current(next);
	}, []);

	// Stable identity so the generic debounce only restarts on user edits,
	// not on unrelated re-renders (e.g. simulation progress updates).
	const draft = useMemo(
		() => ({ runCount: runCountText, seed: seedText }),
		[runCountText, seedText],
	);
	const settledDraft = useDebouncedValue(draft, DEBOUNCE_MS);
	const initialDraftRef = useRef(draft);
	useEffect(() => {
		if (settledDraft === initialDraftRef.current) return;
		commitTexts(settledDraft.runCount, settledDraft.seed);
	}, [settledDraft, commitTexts]);

	function updateRunCountInput(value: string) {
		setRunCountText(value);
		setDirtyFields((dirty) =>
			dirty.runCount ? dirty : { ...dirty, runCount: true },
		);
	}

	function updateSeedInput(value: string) {
		setSeedText(value);
		setDirtyFields((dirty) => (dirty.seed ? dirty : { ...dirty, seed: true }));
	}

	// Commit-on-blur/Apply entry point. Unmounting with a pending draft
	// intentionally discards it instead of flushing.
	function applyImmediately() {
		commitTexts(runCountText, seedText);
	}

	const hasPendingChanges =
		runCountText !== String(config.runCount) ||
		seedText !== displaySeed(config.seed);

	return {
		runCountInput: runCountText,
		seedInput: seedText,
		hasPendingChanges,
		updateRunCountInput,
		updateSeedInput,
		applyImmediately,
	};
}
