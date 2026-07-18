import { useEffect, useRef, useState } from "react";
import type { StochasticConfig } from "@/lib/projection";

const DEBOUNCE_MS = 2000;

export function useDebouncedStochasticConfig(
	config: StochasticConfig,
	onConfigChange: (config: StochasticConfig) => void,
) {
	const [draftRunCount, setDraftRunCount] = useState(String(config.runCount));
	const [draftSeed, setDraftSeed] = useState(
		config.seed !== null ? String(config.seed) : "",
	);
	const [pendingConfig, setPendingConfig] = useState<StochasticConfig | null>(
		null,
	);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const hasPendingChanges = pendingConfig !== null;

	const runCountInput =
		pendingConfig !== null ? draftRunCount : String(config.runCount);
	const seedInput =
		pendingConfig !== null
			? draftSeed
			: config.seed !== null
				? String(config.seed)
				: "";

	const parsedRunCount = Number.isFinite(Number(runCountInput))
		? Math.max(1, Math.min(10000, Math.trunc(Number(runCountInput))))
		: config.runCount;
	const parsedSeed =
		seedInput.trim().length > 0 && Number.isFinite(Number(seedInput))
			? Number(seedInput)
			: null;

	function scheduleConfigChange(nextConfig: StochasticConfig) {
		setPendingConfig(nextConfig);

		if (debounceRef.current !== null) {
			clearTimeout(debounceRef.current);
		}

		debounceRef.current = setTimeout(() => {
			onConfigChange(nextConfig);
			setPendingConfig(null);
			debounceRef.current = null;
		}, DEBOUNCE_MS);
	}

	function applyImmediately() {
		if (debounceRef.current !== null) {
			clearTimeout(debounceRef.current);
			debounceRef.current = null;
		}

		const nextConfig: StochasticConfig = {
			runCount: parsedRunCount,
			seed: parsedSeed,
		};

		onConfigChange(nextConfig);
		setPendingConfig(null);
	}

	function updateRunCountInput(value: string) {
		setDraftRunCount(value);
		scheduleConfigChange({
			runCount: Number.isFinite(Number(value))
				? Math.max(1, Math.min(10000, Math.trunc(Number(value))))
				: config.runCount,
			seed: parsedSeed,
		});
	}

	function updateSeedInput(value: string) {
		setDraftSeed(value);
		scheduleConfigChange({
			runCount: parsedRunCount,
			seed:
				value.trim().length > 0 && Number.isFinite(Number(value))
					? Number(value)
					: null,
		});
	}

	useEffect(() => {
		return () => {
			if (debounceRef.current !== null) {
				clearTimeout(debounceRef.current);
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
