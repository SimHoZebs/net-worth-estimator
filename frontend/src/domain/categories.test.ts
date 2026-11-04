import { expect, it } from "vitest";
import {
	transactionCategoryLabel,
	transactionCategoryOptions,
	transactionCategorySourceLabel,
	transactionCategorySourceOf,
} from "./categories.ts";

it("labels every supported category and falls back to an unknown key", () => {
	expect(transactionCategoryLabel("FOOD_AND_DRINK")).toBe("Food & drink");
	expect(transactionCategoryLabel("MEDICAL")).toBe("Medical");
	expect(transactionCategoryLabel("FUTURE_CATEGORY")).toBe("FUTURE_CATEGORY");
	expect(transactionCategoryLabel(null)).toBeNull();
	expect(transactionCategoryOptions).toHaveLength(16);
});

it("names every assignment source and ignores unknown values", () => {
	expect(transactionCategorySourceOf("bank")).toBe("bank");
	expect(transactionCategorySourceOf("inferred")).toBe("inferred");
	expect(transactionCategorySourceOf("user")).toBe("user");
	expect(transactionCategorySourceOf("other")).toBeNull();
	expect(transactionCategorySourceLabel("bank")).toBe("From your bank");
	expect(transactionCategorySourceLabel("inferred")).toBe("Suggested");
	expect(transactionCategorySourceLabel("user")).toBe("Set by you");
	expect(transactionCategorySourceLabel(null)).toBe("Not categorized");
});
