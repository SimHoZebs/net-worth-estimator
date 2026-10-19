import { describe, expect, it } from "vitest";
import {
	DRAWER_CLOSE_DURATION,
	DRAWER_DESKTOP_OFFSET,
	DRAWER_OPEN_DURATION,
	drawerHiddenX,
} from "./drawer.ts";

describe("shared drawer slide", () => {
	it("slides the full off-canvas width on mobile, mirrored by side", () => {
		expect(drawerHiddenX("left", true)).toBe("-100%");
		expect(drawerHiddenX("right", true)).toBe("100%");
	});

	it("keeps a subtle docked offset on larger viewports, mirrored by side", () => {
		expect(drawerHiddenX("left", false)).toBe(-DRAWER_DESKTOP_OFFSET);
		expect(drawerHiddenX("right", false)).toBe(DRAWER_DESKTOP_OFFSET);
	});

	it("opens slower than it closes", () => {
		expect(DRAWER_OPEN_DURATION).toBeGreaterThan(DRAWER_CLOSE_DURATION);
	});
});
