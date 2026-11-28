import { describe, expect, it } from "vitest";
import {
	FALLBACK_PROVIDERS,
	FALLBACK_RESOLVERS,
	FALLBACK_TEMPLATES,
	plainLanguageForAmount,
} from "./amountCatalog.ts";
import { buildTemplateAmount } from "../components/editors/AmountBuilder.tsx";
import {
	patchTemplateAmount,
	templateFieldsFromAmount,
} from "../components/editors/amountDraft.ts";

describe("amount catalog", () => {
	it("exposes every resolver and provider in plain language", () => {
		expect(FALLBACK_RESOLVERS.length).toBeGreaterThanOrEqual(2);
		expect(FALLBACK_PROVIDERS.length).toBeGreaterThanOrEqual(7);
		expect(FALLBACK_TEMPLATES.length).toBeGreaterThanOrEqual(8);
		for (const template of FALLBACK_TEMPLATES) {
			expect(template.label).toBeTruthy();
			expect(template.summary).toBeTruthy();
			expect(plainLanguageForAmount(template.amount)).toBeTruthy();
		}
	});

	it("builds wire amounts for every template", () => {
		const accounts = [{ id: "checking" }, { id: "brokerage" }];
		for (const template of FALLBACK_TEMPLATES) {
			const amount = buildTemplateAmount(template.id, {}, accounts);
			expect(amount.resolver).toBe(
				template.resolver ?? template.amount?.resolver,
			);
			expect(plainLanguageForAmount(amount)).toBeTruthy();
		}
	});
	it("uses the selected live account for built-in investment growth", () => {
		const amount = buildTemplateAmount(
			"investment-growth",
			{ refId: "brokerage", annualRate: "0.07", volatility: "0.12" },
			[{ id: "checking" }],
		);
		expect(amount).toMatchObject({
			config: { expression: "brokerage * rate" },
			inputs: {
				brokerage: {
					provider: "account-balance",
					arguments: { id: "brokerage" },
				},
			},
		});
		const saved = {
			...amount,
			inputs: {
				...amount.inputs,
				brokerage: {
					source: "provider" as const,
					provider: "model-value",
					arguments: { id: "old-transaction" },
				},
			},
		};
		expect(
			patchTemplateAmount("investment-growth", saved, amount, {}),
		).toMatchObject({
			inputs: {
				brokerage: { provider: "account-balance" },
			},
		});
		expect(templateFieldsFromAmount("investment-growth", saved)).toMatchObject({
			refId: "old-transaction",
		});
	});
	it("keeps custom preset transaction bindings unchanged", () => {
		const saved = {
			resolver: "expression",
			config: { expression: "base" },
			inputs: {
				base: {
					source: "provider" as const,
					provider: "model-value",
					arguments: { id: "salary" },
				},
			},
		};
		expect(
			patchTemplateAmount(
				"custom",
				saved,
				buildTemplateAmount("fixed", {}, []),
				{},
			),
		).toEqual(saved);
	});
	it("retains schedule-percent and owed-balance as supported presets", () => {
		expect(
			buildTemplateAmount(
				"schedule-percent",
				{ reference: "salary", percent: "0.2" },
				[],
			),
		).toMatchObject({
			config: { expression: "base * share" },
			inputs: {
				base: {
					provider: "model-value",
					arguments: { id: "salary" },
				},
				share: { value: 0.2 },
			},
		});
		expect(
			buildTemplateAmount("owed-balance", { accountId: "card" }, []),
		).toMatchObject({
			config: { expression: "(abs(balance) - balance) / 2" },
			inputs: {
				balance: {
					provider: "account-balance",
					arguments: { id: "card" },
				},
			},
		});
	});
});
