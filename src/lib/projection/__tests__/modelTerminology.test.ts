import { describe, expect, it } from "vitest";
import { createBasePack, makeSettings } from "../__fixtures__";
import {
	projectFinancialModelDocument,
	projectScenarioPack,
} from "../analysis/projectFinancialModel";
import { projectScenarioPack as projectScenarioPackFromShim } from "../analysis/projectScenario";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";
import {
	CSV_MODEL_FILE_NAMES,
	CSV_MODEL_PUBLIC_PATH,
	CSV_MODEL_REPO_PATH,
	CSV_SCENARIO_FILE_NAMES,
	CSV_SCENARIO_PUBLIC_PATH,
	CSV_SCENARIO_REPO_PATH,
	FINANCIAL_MODEL_DOCUMENT_VERSION,
	SCENARIO_MODEL_VERSION,
} from "../types/model";

describe("core model terminology", () => {
	it("keeps legacy constants as aliases of canonical model constants", () => {
		expect(SCENARIO_MODEL_VERSION).toBe(FINANCIAL_MODEL_DOCUMENT_VERSION);
		expect(CSV_SCENARIO_REPO_PATH).toBe(CSV_MODEL_REPO_PATH);
		expect(CSV_SCENARIO_PUBLIC_PATH).toBe(CSV_MODEL_PUBLIC_PATH);
		expect(CSV_SCENARIO_FILE_NAMES).toBe(CSV_MODEL_FILE_NAMES);
	});

	it("projects through canonical and compatibility entry points", () => {
		const document = createBasePack();
		const settings = makeSettings();
		const canonical = projectFinancialModelDocument(document, settings);

		expect(projectScenarioPack(document, settings)).toEqual(canonical);
		expect(projectScenarioPackFromShim(document, settings)).toEqual(canonical);
	});

	it("exposes only the canonical effective document runtime field", () => {
		const { path } = projectRawFinancialModelDocument(
			createBasePack(),
			makeSettings(),
		);

		expect(path.effectiveDocument.accounts.length).toBeGreaterThan(0);
		expect(path).not.toHaveProperty("effectivePack");
	});
});
