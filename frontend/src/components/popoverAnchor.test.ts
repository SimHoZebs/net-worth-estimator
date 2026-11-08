import { afterEach, describe, expect, it, vi } from "vitest";
import { placePopover } from "./popoverAnchor.ts";

function element(rect: Partial<DOMRect>) {
	const el = document.createElement("div");
	vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
		width: 0,
		height: 0,
		x: 0,
		y: 0,
		toJSON: () => ({}),
		...rect,
	} as DOMRect);
	return el;
}

describe("placePopover", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("places a wide menu below a left trigger", () => {
		vi.stubGlobal("innerHeight", 800);
		vi.stubGlobal("innerWidth", 1024);
		const pop = element({});
		const trigger = element({
			left: 100,
			right: 140,
			top: 100,
			bottom: 140,
			width: 40,
		});
		placePopover(pop, trigger, { width: 240 });
		expect(pop.style.left).toBe("100px");
		expect(pop.style.top).toBe("144px");
		expect(pop.style.width).toBe("240px");
	});

	it("aligns a menu to the right edge of its trigger", () => {
		vi.stubGlobal("innerHeight", 800);
		vi.stubGlobal("innerWidth", 1024);
		const pop = element({});
		const trigger = element({
			left: 700,
			right: 740,
			top: 100,
			bottom: 140,
			width: 40,
		});
		placePopover(pop, trigger, { width: 240, align: "right" });
		expect(pop.style.left).toBe("500px");
	});

	it("flips above the trigger when the space below is short", () => {
		vi.stubGlobal("innerHeight", 800);
		vi.stubGlobal("innerWidth", 1024);
		const pop = element({});
		const trigger = element({
			left: 100,
			right: 140,
			top: 600,
			bottom: 700,
			width: 40,
		});
		placePopover(pop, trigger, { width: 240 });
		expect(pop.style.bottom).toBe("204px");
		expect(pop.style.top).toBe("auto");
	});

	it("clamps the menu inside a narrow viewport", () => {
		vi.stubGlobal("innerHeight", 800);
		vi.stubGlobal("innerWidth", 360);
		const pop = element({});
		const trigger = element({
			left: 300,
			right: 340,
			top: 100,
			bottom: 140,
			width: 40,
		});
		placePopover(pop, trigger, { width: 240 });
		expect(pop.style.left).toBe("112px");
	});
});
