import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Recurrence } from "../../domain/recurrence.ts";
import { useEditDraft } from "./useEditDraft.ts";

type Draft = {
	name: string;
	enabled: boolean;
	recurrence: Recurrence | null;
};

const monthly = (interval: number): Recurrence => ({
	unit: "month",
	interval,
	monthlyMode: "byDate",
});

/**
 * The recurrence source is rebuilt from the stored schedule on every
 * render, so equal cadences arrive with fresh object identities.
 */
const freshSource = (): Draft => ({
	name: "Rent",
	enabled: true,
	recurrence: monthly(1),
});

describe("useEditDraft recurrence", () => {
	it("keeps a cadence edit across re-renders that rebuild the source", () => {
		const { result, rerender } = renderHook(
			({ source }: { source: Draft }) => useEditDraft("rule", source),
			{ initialProps: { source: freshSource() } },
		);
		act(() => {
			result.current.update({ recurrence: monthly(2) });
		});
		expect(result.current.dirty).toBe(true);
		expect(result.current.conflict).toBe(false);
		// A later render rebuilds the source with an equal but new object.
		rerender({ source: freshSource() });
		expect(result.current.dirty).toBe(true);
		expect(result.current.conflict).toBe(false);
	});

	it("flags a concurrent cadence change as a conflict", () => {
		const { result, rerender } = renderHook(
			({ source }: { source: Draft }) => useEditDraft("rule", source),
			{ initialProps: { source: freshSource() } },
		);
		act(() => {
			result.current.update({ recurrence: monthly(2) });
		});
		rerender({
			source: { name: "Rent", enabled: true, recurrence: monthly(3) },
		});
		expect(result.current.conflict).toBe(true);
	});

	it("clears the edit when the cadence returns to the stored value", () => {
		const { result, rerender } = renderHook(
			({ source }: { source: Draft }) => useEditDraft("rule", source),
			{ initialProps: { source: freshSource() } },
		);
		act(() => {
			result.current.update({ recurrence: monthly(2) });
		});
		expect(result.current.dirty).toBe(true);
		rerender({ source: freshSource() });
		act(() => {
			result.current.update({ recurrence: monthly(1) });
		});
		expect(result.current.dirty).toBe(false);
		expect(result.current.conflict).toBe(false);
	});

	it("still compares text fields by value", () => {
		const { result, rerender } = renderHook(
			({ source }: { source: Draft }) => useEditDraft("rule", source),
			{ initialProps: { source: freshSource() } },
		);
		act(() => {
			result.current.update({ name: "Rent!" });
		});
		rerender({ source: { ...freshSource(), name: "Rent?" } });
		expect(result.current.conflict).toBe(true);
	});
});
