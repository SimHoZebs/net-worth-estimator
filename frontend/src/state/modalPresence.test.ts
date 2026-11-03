import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAnyModalOpen, useModalRegistration } from "./modalPresence.ts";

afterEach(() => {
	cleanup();
});

describe("modal presence", () => {
	it("reports a modal only while a registration is active", () => {
		const reader = renderHook(() => useAnyModalOpen());
		expect(reader.result.current).toBe(false);
		const modal = renderHook(({ active }) => useModalRegistration(active), {
			initialProps: { active: true },
		});
		expect(reader.result.current).toBe(true);
		modal.rerender({ active: false });
		expect(reader.result.current).toBe(false);
		modal.unmount();
		expect(reader.result.current).toBe(false);
	});

	it("stays open until the last overlapping modal unregisters", () => {
		const reader = renderHook(() => useAnyModalOpen());
		const lower = renderHook(() => useModalRegistration(true));
		const upper = renderHook(() => useModalRegistration(true));
		lower.unmount();
		expect(reader.result.current).toBe(true);
		upper.unmount();
		expect(reader.result.current).toBe(false);
	});
});
