import { useEffect, useRef, useState } from "react";
import type { StochasticConfig } from "@/lib/projection";

const DEBOUNCE_MS = 2000;

export function useDebouncedStochasticConfig(
  config: StochasticConfig,
  onConfigChange: (config: StochasticConfig) => void,
  parsedRunCount: number,
  parsedSeed: number | null,
) {
  const [pendingConfig, setPendingConfig] = useState<StochasticConfig | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasPendingChanges = pendingConfig !== null;

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

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return { hasPendingChanges, pendingConfig, scheduleConfigChange, applyImmediately };
}
