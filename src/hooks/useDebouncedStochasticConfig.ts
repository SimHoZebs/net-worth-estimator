import { useCallback, useEffect, useRef, useState } from "react";
import type { StochasticConfig } from "@/lib/projection";
import { normalizeStochasticConfig } from "@/lib/projection/utils/stochastic";
import { useDebouncedValue } from "./useDebouncedValue";

const DEBOUNCE_MS = 2000;

interface PendingDraft {
	runCount?: string;
	seed?: string;
}

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

function applyPendingDraft(config: StochasticConfig, draft: PendingDraft) {
	const nextConfig = { ...config };
	let hasValidField = false;

	if (draft.runCount !== undefined) {
		const runCount = parseRunCount(draft.runCount);
		if (runCount !== null) {
			nextConfig.runCount = normalizeStochasticConfig({
				runCount,
				seed: null,
			}).runCount;
			hasValidField = true;
		}
	}

	if (draft.seed !== undefined) {
		const seed = parseSeed(draft.seed);
		if (seed !== undefined) {
			nextConfig.seed = seed;
			hasValidField = true;
		}
	}

	return { nextConfig, hasValidField };
}

export function useDebouncedStochasticConfig(
	config: StochasticConfig,
	onConfigChange: (config: StochasticConfig) => void,
) {
	const [draftRunCount, setDraftRunCount] = useState(String(config.runCount));
	const [draftSeed, setDraftSeed] = useState(
		config.seed !== null ? String(config.seed) : "",
	);
	const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
	const settledDraft = useDebouncedValue(pendingDraft, DEBOUNCE_MS);
	const pendingDraftRef = useRef<PendingDraft | null>(null);
	const configRef = useRef(config);
	configRef.current = config;
	const onConfigChangeRef = useRef(onConfigChange);
	onConfigChangeRef.current = onConfigChange;

	const hasPendingChanges = pendingDraft !== null;
	const pendingConfig =
		pendingDraft !== null
			? applyPendingDraft(config, pendingDraft).nextConfig
			: null;

	const runCountInput =
		pendingDraft?.runCount !== undefined
			? draftRunCount
			: String(config.runCount);
	const seedInput =
		pendingDraft?.seed !== undefined
			? draftSeed
			: config.seed !== null
				? String(config.seed)
				: "";

	const flushPendingDraft = useCallback(() => {
		if (pendingDraftRef.current === null) return;
		const { nextConfig, hasValidField } = applyPendingDraft(
			configRef.current,
			pendingDraftRef.current,
		);
		pendingDraftRef.current = null;
		setPendingDraft(null);
		if (hasValidField) onConfigChangeRef.current(nextConfig);
	}, []);

	useEffect(() => {
		if (settledDraft === null || pendingDraftRef.current !== settledDraft) {
			return;
		}
		flushPendingDraft();
	}, [settledDraft, flushPendingDraft]);

	useEffect(() => {
		return () => {
			flushPendingDraft();
		};
	}, [flushPendingDraft]);

	function updateDraft(draft: PendingDraft) {
		const nextDraft = { ...pendingDraftRef.current, ...draft };
		pendingDraftRef.current = nextDraft;
		setPendingDraft(nextDraft);
	}

	function updateRunCountInput(value: string) {
		setDraftRunCount(value);
		updateDraft({ runCount: value });
	}

	function updateSeedInput(value: string) {
		setDraftSeed(value);
		updateDraft({ seed: value });
	}

	function applyImmediately() {
		flushPendingDraft();
	}

	return {
		runCountInput,
		seedInput,
		hasPendingChanges,
		pendingConfig,
		updateRunCountInput,
		updateSeedInput,
		applyImmediately,
	};
}
