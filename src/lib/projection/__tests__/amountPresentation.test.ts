import { describe, expect, it } from "vitest";
import {
	describePostingAmount,
	getAmountPresentation,
} from "../model/amountPresentation";
import type { PostingAmountResolution } from "../types/model";

describe("amount presentation", () => {
	it("preserves expression descriptions", () => {
		expect(
			describePostingAmount({
				amount: {
					resolver: "expression",
					config: { expression: "balance * rate" },
					inputs: {},
				},
			}),
		).toBe("balance * rate");
	});

	it("recursively presents arbitrary descriptors without resolver branches", () => {
		const amount: PostingAmountResolution = {
			resolver: "custom-composite",
			config: {
				profileId: "primary-profile",
				steps: [
					{
						resolver: "first-operation",
						config: { coefficient: 0.4 },
					},
				],
			},
			inputs: {
				amount: { source: "literal", value: 125 },
			},
		};

		expect(getAmountPresentation(amount)).toEqual({
			summary: "Custom composite calculation",
			sections: [
				{
					label: "Configuration",
					children: [
						{ label: "Profile ID", value: "primary-profile" },
						{
							label: "Steps",
							children: [
								{
									label: "First operation calculation",
									children: [
										{
											label: "Config",
											children: [{ label: "Coefficient", value: "0.4" }],
										},
									],
								},
							],
						},
					],
				},
				{
					label: "Inputs",
					children: [
						{
							label: "Amount",
							children: [
								{ label: "Source", value: "literal" },
								{ label: "Value", value: "125" },
							],
						},
					],
				},
			],
		});
	});
});
