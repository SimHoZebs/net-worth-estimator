import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	isTopmostModal,
	useHasOpenModal,
	useOpenModalRegistration,
} from "./modalStack.ts";

afterEach(() => {
	cleanup();
});

describe("modal stack", () => {
	it("reports no dialog when none registers", () => {
		expect(renderHook(() => useHasOpenModal()).result.current).toBe(false);
	});

	it("marks only the last registrant topmost", () => {
		const first = renderHook(() => useOpenModalRegistration(true));
		const firstId = first.result.current;
		expect(firstId).not.toBeNull();
		expect(renderHook(() => useHasOpenModal()).result.current).toBe(true);
		const second = renderHook(() => useOpenModalRegistration(true));
		const secondId = second.result.current;
		expect(isTopmostModal(firstId)).toBe(false);
		expect(isTopmostModal(secondId)).toBe(true);
		first.unmount();
		expect(isTopmostModal(secondId)).toBe(true);
		expect(renderHook(() => useHasOpenModal()).result.current).toBe(true);
		second.unmount();
		expect(renderHook(() => useHasOpenModal()).result.current).toBe(false);
	});

	it("ignores inactive registrants", () => {
		const idle = renderHook(() => useOpenModalRegistration(false));
		expect(idle.result.current).toBeNull();
		expect(renderHook(() => useHasOpenModal()).result.current).toBe(false);
	});
});
