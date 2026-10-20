import { describe, expect, it } from "vitest";
import {
	FALLBACK_PROVIDERS,
	FALLBACK_RESOLVERS,
	FALLBACK_TEMPLATES,
	plainLanguageForAmount,
} from "./amountCatalog.ts";
import { buildTemplateAmount } from "../components/editors/AmountBuilder.tsx";

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
});
