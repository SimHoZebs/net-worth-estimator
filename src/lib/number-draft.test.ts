import { describe, expect, it } from "vitest";
import { parseDecimalDraft } from "./number-draft";

describe("parseDecimalDraft", () => {
	it.each([
		["72000.5", 72_000.5],
		[".5", 0.5],
		["1e6", 1_000_000],
		["-2.5E-2", -0.025],
	])("parses decimal input %s", (input, expected) => {
		expect(parseDecimalDraft(input)).toBe(expected);
	});

	it.each([
		"",
		"-",
		"0x10",
		"0b10",
		"0o10",
		"Infinity",
	])("rejects non-decimal input %s", (input) => {
		expect(parseDecimalDraft(input)).toBeNull();
	});
});
