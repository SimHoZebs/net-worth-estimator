import { afterEach, describe, expect, it, vi } from 'vitest';
import { examplePlan } from '../domain/example.ts';
import { loadWorkspace, parsePlan, persistWorkspace, STORAGE_KEY } from './storage.ts';

afterEach(() => vi.unstubAllGlobals());
describe('local storage boundary', () => {
  it('returns null for a first visit', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(loadWorkspace()).toBeNull();
  });
  it('never substitutes example data for a corrupt saved source', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{invalid' });
    expect(loadWorkspace()).toBeInstanceOf(Error);
  });
  it('preserves save failures as recoverable error values', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Quota'); } });
    expect(persistWorkspace({ version: 1, saved: examplePlan, draft: null, snapshot: null })).toBeInstanceOf(Error);
  });
  it('round-trips saved plans and drafts together', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null });
    const workspace = { version: 1 as const, saved: examplePlan, draft: { ...examplePlan, name: 'Temporary plan' }, snapshot: null };
    expect(persistWorkspace(workspace)).toBeNull();
    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadWorkspace()).toEqual(workspace);
  });
  it('rejects stale writes from another browser tab', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => 'a-newer-workspace', setItem });
    const result = persistWorkspace({ version: 1, saved: examplePlan, draft: null, snapshot: null }, 'an-older-workspace');
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toContain('another tab');
    expect(setItem).not.toHaveBeenCalled();
  });
  it('validates imports rather than trusting file extensions', () => {
    expect(parsePlan('not json')).toBeInstanceOf(Error);
    expect(parsePlan('{"schemaVersion":1}')).toBeInstanceOf(Error);
    expect(parsePlan(JSON.stringify(examplePlan))).toEqual(examplePlan);
  });
});
