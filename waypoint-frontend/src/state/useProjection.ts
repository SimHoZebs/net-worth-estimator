import { useEffect, useMemo, useState } from 'react';
import * as errore from 'errore';
import type { Plan } from '../domain/model.ts';
import { project, type RangeResult } from '../domain/projection.ts';

class CalculationError extends errore.createTaggedError({ name: 'CalculationError', message: 'The projection could not be calculated. Inspect account balances and assumptions, then retry.' }) {}
type RangeState = { key: string; result: RangeResult | null; progress: number; error: string | null };

export function useProjection({ plan, years, ranges }: { plan: Plan; years: number; ranges: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const base = useMemo(() => errore.try({ try: () => project({ plan, years }), catch: (cause) => new CalculationError({ cause }) }), [plan, years]);
  const key = useMemo(() => JSON.stringify({ plan, years, attempt }), [plan, years, attempt]);
  const [state, setState] = useState<RangeState | null>(null);
  useEffect(() => {
    if (!ranges || base instanceof Error) return;
    const worker = errore.try({ try: () => new Worker(new URL('./range.worker.ts', import.meta.url), { type: 'module' }), catch: (cause) => new CalculationError({ cause }) });
    if (worker instanceof Error) {
      console.warn(worker.message);
      setState({ key, result: null, progress: 0, error: worker.message });
      return;
    }
    worker.onmessage = (event: MessageEvent<{ type: string; progress?: number; result?: RangeResult; message?: string }>) => {
      if (event.data.type === 'result' && event.data.result) setState({ key, result: event.data.result, progress: 1, error: null });
      if (event.data.type === 'progress') setState({ key, result: null, progress: event.data.progress ?? 0, error: null });
      if (event.data.type === 'error') setState({ key, result: null, progress: 0, error: event.data.message ?? 'Range unavailable. Retry the calculation.' });
    };
    worker.onerror = () => setState({ key, result: null, progress: 0, error: 'The scenario worker stopped. Retry the calculation.' });
    worker.postMessage({ plan, years });
    return () => worker.terminate();
  }, [plan, years, ranges, key, base]);
  const current = state?.key === key ? state : null;
  return { base, range: ranges ? current?.result ?? null : null, progress: current?.progress ?? 0, rangeError: current?.error ?? null, retryRange: () => setAttempt((a) => a + 1) };
}
