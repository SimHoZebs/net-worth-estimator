import { describe, expect, it } from "vitest";
import type { AmountPreset } from "../../api/contracts.ts";
import { amountTemplatesFromPresets } from "./amountTemplates.ts";

const custom: AmountPreset = {
	id: "preset-1",
	name: "bonus",
	label: "Yearly bonus",
	enabled: true,
	amount: {
		resolver: "expression",
		config: { expression: "base" },
		inputs: {
			base: {
				source: "provider",
				provider: "model-value",
				arguments: { id: "salary" },
			},
		},
	},
};

describe("saved amount templates", () => {
	it("keeps saved labels and definitions alongside schedule-specific choices", () => {
		const templates = amountTemplatesFromPresets([custom]);
		expect(templates.find((template) => template.id === "bonus")).toMatchObject(
			{
				label: "Yearly bonus",
				amount: custom.amount,
			},
		);
		expect(templates.map((template) => template.id)).toEqual(
			expect.arrayContaining(["schedule-percent", "owed-balance"]),
		);
	});
	it("does not duplicate a schedule-specific preset saved on the server", () => {
		const templates = amountTemplatesFromPresets([
			custom,
			{
				...custom,
				id: "preset-2",
				name: "schedule-percent",
				label: "Saved schedule share",
			},
		]);
		expect(
			templates.filter((template) => template.id === "schedule-percent"),
		).toHaveLength(1);
		expect(
			templates.find((template) => template.id === "schedule-percent")?.label,
		).toBe("Saved schedule share");
	});
});
