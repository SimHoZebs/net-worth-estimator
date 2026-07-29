import { useEffect, useRef, useState } from "react";
import type { StochasticConfig } from "@/lib/projection";

const DEBOUNCE_MS = 2000;

interface PendingDraft {
	runCount?: string;
	seed?: string;
}

function applyPendingDraft(config: StochasticConfig, draft: PendingDraft) {
	const nextConfig = { ...config };
	let hasValidField = false;

	if (draft.runCount !== undefined && draft.runCount.trim() !== "") {
		const runCount = Number(draft.runCount);
		if (Number.isFinite(runCount)) {
			nextConfig.runCount = Math.max(1, Math.min(10000, Math.trunc(runCount)));
			hasValidField = true;
		}
	}

	if (draft.seed !== undefined) {
		if (draft.seed.trim() === "") {
			nextConfig.seed = null;
			hasValidField = true;
		} else {
			const seed = Number(draft.seed);
			if (Number.isFinite(seed)) {
				nextConfig.seed = seed;
				hasValidField = true;
			}
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
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

	function scheduleConfigChange(draft: PendingDraft) {
		const nextDraft = { ...pendingDraftRef.current, ...draft };
		setPendingDraft(nextDraft);
		pendingDraftRef.current = nextDraft;

		if (debounceRef.current !== null) {
			clearTimeout(debounceRef.current);
		}

		debounceRef.current = setTimeout(() => {
			const pending = pendingDraftRef.current;
			if (pending !== null) {
				const { nextConfig, hasValidField } = applyPendingDraft(
					configRef.current,
					pending,
				);
				if (hasValidField) onConfigChangeRef.current(nextConfig);
			}
			setPendingDraft(null);
			pendingDraftRef.current = null;
			debounceRef.current = null;
		}, DEBOUNCE_MS);
	}

	function applyImmediately() {
		if (debounceRef.current !== null) {
			clearTimeout(debounceRef.current);
			debounceRef.current = null;
		}

		if (pendingDraftRef.current !== null) {
			const { nextConfig, hasValidField } = applyPendingDraft(
				configRef.current,
				pendingDraftRef.current,
			);
			if (hasValidField) onConfigChangeRef.current(nextConfig);
		}
		setPendingDraft(null);
		pendingDraftRef.current = null;
	}

	function updateRunCountInput(value: string) {
		setDraftRunCount(value);
		scheduleConfigChange({ runCount: value });
	}

	function updateSeedInput(value: string) {
		setDraftSeed(value);
		scheduleConfigChange({ seed: value });
	}

	useEffect(() => {
		return () => {
			if (debounceRef.current !== null) {
				clearTimeout(debounceRef.current);
			}
			if (pendingDraftRef.current !== null) {
				const { nextConfig, hasValidField } = applyPendingDraft(
					configRef.current,
					pendingDraftRef.current,
				);
				if (hasValidField) onConfigChangeRef.current(nextConfig);
			}
		};
	}, []);

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
