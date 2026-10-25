import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	isTopmostDialog,
	useHasOpenDialog,
	useOpenDialogRegistration,
} from "./dialogStack.ts";

afterEach(() => {
	cleanup();
});

describe("dialog stack", () => {
	it("reports no dialog when none registers", () => {
		expect(renderHook(() => useHasOpenDialog()).result.current).toBe(false);
	});

	it("marks only the last registrant topmost", () => {
		const first = renderHook(() => useOpenDialogRegistration(true));
		const firstId = first.result.current;
		expect(firstId).not.toBeNull();
		expect(renderHook(() => useHasOpenDialog()).result.current).toBe(true);
		const second = renderHook(() => useOpenDialogRegistration(true));
		const secondId = second.result.current;
		expect(isTopmostDialog(firstId)).toBe(false);
		expect(isTopmostDialog(secondId)).toBe(true);
		first.unmount();
		expect(isTopmostDialog(secondId)).toBe(true);
		expect(renderHook(() => useHasOpenDialog()).result.current).toBe(true);
		second.unmount();
		expect(renderHook(() => useHasOpenDialog()).result.current).toBe(false);
	});

	it("ignores inactive registrants", () => {
		const idle = renderHook(() => useOpenDialogRegistration(false));
		expect(idle.result.current).toBeNull();
		expect(renderHook(() => useHasOpenDialog()).result.current).toBe(false);
	});
});
