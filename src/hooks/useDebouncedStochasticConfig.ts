import { useEffect, useRef, useState } from "react";
import type { StochasticConfig } from "@/lib/projection";
import { useDebouncedValue } from "./useDebouncedValue";

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

	useEffect(() => {
		if (settledDraft === null || pendingDraftRef.current !== settledDraft) {
			return;
		}
		const { nextConfig, hasValidField } = applyPendingDraft(
			configRef.current,
			settledDraft,
		);
		pendingDraftRef.current = null;
		setPendingDraft(null);
		if (hasValidField) onConfigChangeRef.current(nextConfig);
	}, [settledDraft]);

	useEffect(() => {
		return () => {
			if (pendingDraftRef.current !== null) {
				const { nextConfig, hasValidField } = applyPendingDraft(
					configRef.current,
					pendingDraftRef.current,
				);
				if (hasValidField) onConfigChangeRef.current(nextConfig);
			}
		};
	}, []);

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
		if (pendingDraftRef.current !== null) {
			const { nextConfig, hasValidField } = applyPendingDraft(
				configRef.current,
				pendingDraftRef.current,
			);
			pendingDraftRef.current = null;
			setPendingDraft(null);
			if (hasValidField) onConfigChangeRef.current(nextConfig);
		}
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
