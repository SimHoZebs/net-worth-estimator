import { describe, expect, it } from "vitest";
import { createBaseDocument, makeSettings } from "../__fixtures__";
import { projectFinancialModelDocument } from "../analysis/projectFinancialModel";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";
import {
	CSV_MODEL_FILE_NAMES,
	CSV_MODEL_PUBLIC_PATH,
	CSV_MODEL_REPO_PATH,
} from "../types/model";

describe("core model terminology", () => {
	it("exposes canonical model constants", () => {
		expect(CSV_MODEL_REPO_PATH).toBe("public/configs");
		expect(CSV_MODEL_PUBLIC_PATH).toBe("/configs");
		expect(CSV_MODEL_FILE_NAMES).toEqual({
			accounts: "accounts.csv",
			checkpoints: "checkpoints.csv",
			postings: "postings.csv",
		});
	});

	it("projects through the canonical entry point", () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const result = projectFinancialModelDocument(document, settings);

		expect(result.summary.currentNetWorth).toBe(1600);
	});

	it("exposes only the canonical effective document runtime field", () => {
		const { path } = projectRawFinancialModelDocument(
			createBaseDocument(),
			makeSettings(),
		);

		expect(path.effectiveDocument.accounts.length).toBeGreaterThan(0);
	});
});
