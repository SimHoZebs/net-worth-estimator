import { describe, expect, it } from "vitest";
import { toggleEffectiveId } from "./safeSpendingSelection.ts";

const ids = ["card", "loan", "utilities"];

describe("toggleEffectiveId", () => {
	it("removes an id from an explicit selection", () => {
		expect(toggleEffectiveId(["card", "loan"], ids, "card")).toEqual(["loan"]);
	});

	it("adds an id to an explicit selection", () => {
		expect(toggleEffectiveId(["card"], ids, "loan")).toEqual(["card", "loan"]);
	});

	it("stores null when the toggle covers every known id", () => {
		expect(toggleEffectiveId(["card", "loan"], ids, "utilities")).toBeNull();
		expect(toggleEffectiveId(["card", "utilities"], ids, "loan")).toBeNull();
	});

	it("stores null when the toggle empties the selection", () => {
		expect(toggleEffectiveId(["card"], ids, "card")).toBeNull();
	});

	it("toggles against the fallback when nothing is stored", () => {
		expect(toggleEffectiveId(null, ids, "card", ["loan"])).toEqual([
			"loan",
			"card",
		]);
	});

	it("keeps an explicit list that extends a strict-subset fallback", () => {
		// The fallback subset must not swallow ids the user explicitly added.
		expect(toggleEffectiveId(null, ids, "loan", ["card"])).toEqual([
			"card",
			"loan",
		]);
		expect(
			toggleEffectiveId(["card", "loan"], ids, "utilities", ["card"]),
		).toEqual(["card", "loan", "utilities"]);
	});
});
