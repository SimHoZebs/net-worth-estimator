import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StochasticConfig } from "@/lib/projection";
import { normalizeStochasticConfig } from "@/lib/projection/utils/stochastic";
import { useDebouncedValue } from "./useDebouncedValue";

export const STOCHASTIC_DEBOUNCE_MS = 2000;
const DEBOUNCE_MS = STOCHASTIC_DEBOUNCE_MS;
const MAX_RUN_COUNT = 10_000;

const countFormatter = new Intl.NumberFormat();

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

/**
 * Inline warning for the sample-count draft. Reports clamping (e.g.
 * 20000 → 10,000) and invalid text; null when the draft applies cleanly.
 */
export function runCountDraftNotice(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed === "") {
		return `Enter a whole number from 1 to ${countFormatter.format(MAX_RUN_COUNT)}.`;
	}
	if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
		return `“${trimmed}” isn't a number — keeping the current sample count.`;
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) {
		return `“${trimmed}” isn't a number — keeping the current sample count.`;
	}
	const normalized = normalizeStochasticConfig({
		runCount: parsed,
		seed: null,
	}).runCount;
	if (normalized !== parsed) {
		return `Will clamp ${countFormatter.format(parsed)} → ${countFormatter.format(normalized)}.`;
	}
	return null;
}

/**
 * Inline warning for the seed draft. Blank means auto (no warning);
 * non-numeric text keeps the current seed.
 */
export function seedDraftNotice(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (!/^[+-]?\d+$/.test(trimmed)) {
		return `“${trimmed}” isn't a whole number — keeping the current seed.`;
	}
	return null;
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
	const [lastApplied, setLastApplied] = useState<StochasticConfig | null>(null);
	const [pendingMs, setPendingMs] = useState<number | null>(null);

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
		setPendingMs(null);
		if (changed) {
			setLastApplied(next);
			onConfigChangeRef.current(next);
		}
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

	const hasPendingChanges =
		runCountText !== String(config.runCount) ||
		seedText !== displaySeed(config.seed);

	// Countdown until the debounce settles. Drives the "Will resample in Ns"
	// hint; cleared on commit or when the draft matches the applied config.
	// Draft and config intentionally restart the countdown on every keystroke;
	// hasPendingChanges alone would not restart the timer while it stays true.
	// biome-ignore lint/correctness/useExhaustiveDependencies: restart on keystroke
	useEffect(() => {
		if (!hasPendingChanges) {
			setPendingMs((current) => (current === null ? current : null));
			return;
		}
		setPendingMs(DEBOUNCE_MS);
		const startedAt = Date.now();
		const interval = setInterval(() => {
			const remaining = DEBOUNCE_MS - (Date.now() - startedAt);
			setPendingMs(remaining > 0 ? remaining : 0);
		}, 250);
		return () => clearInterval(interval);
	}, [draft, hasPendingChanges, config]);

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

	// Commit-on-blur/Apply entry point. Also flushed on unmount (see below)
	// so navigating away mid-debounce never loses the draft.
	function applyImmediately() {
		commitTexts(runCountText, seedText);
	}

	// Flush a pending draft on unmount: navigating away with <2s left still
	// applies the edit to the store instead of discarding it. Invalid drafts
	// revert without touching the store (commitTexts guards on no-change).
	const latestTextsRef = useRef(draft);
	latestTextsRef.current = draft;
	const commitTextsRef = useRef(commitTexts);
	commitTextsRef.current = commitTexts;
	useEffect(() => {
		return () => {
			const latest = latestTextsRef.current;
			commitTextsRef.current(latest.runCount, latest.seed);
		};
	}, []);

	return {
		runCountInput: runCountText,
		seedInput: seedText,
		hasPendingChanges,
		pendingMs,
		lastApplied,
		runCountNotice: runCountDraftNotice(runCountText),
		seedNotice: seedDraftNotice(seedText),
		updateRunCountInput,
		updateSeedInput,
		applyImmediately,
	};
}
