import { afterEach, describe, expect, it } from "vitest";
import {
	acquireModalLock,
	DRAWER_CLOSE_DURATION,
	DRAWER_DESKTOP_OFFSET,
	DRAWER_OPEN_DURATION,
	drawerHiddenX,
	releaseModalLock,
} from "./drawer.ts";

afterEach(() => {
	document.body.style.overflow = "";
	document.getElementById("root")?.remove();
});

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

describe("modal lock", () => {
	it("holds scroll and inertness until the last sheet closes", () => {
		const root = document.createElement("div");
		root.id = "root";
		document.body.appendChild(root);
		document.body.style.overflow = "";
		acquireModalLock();
		acquireModalLock();
		releaseModalLock();
		expect(document.body.style.overflow).toBe("hidden");
		expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
		releaseModalLock();
		expect(document.body.style.overflow).toBe("");
		expect(
			document.getElementById("root")?.hasAttribute("inert") ?? false,
		).toBe(false);
	});
});
