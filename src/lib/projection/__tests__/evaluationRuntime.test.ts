import { describe, expect, it } from "vitest";
import { makeSettings, validCsvFiles } from "../__fixtures__";
import {
	type EvaluationDefinition,
	EvaluationRegistry,
	EvaluationRuntimeSet,
	getFinancialIndependenceConfig,
	getFinancialIndependenceResult,
	getNetWorthThresholdConfig,
	getNetWorthThresholdResult,
	isJsonValue,
	parseCsvFinancialModel,
	projectFinancialModelDocument,
} from "../index";
import type {
	EvaluationInstance,
	EvaluationResultCollection,
	EvaluationTables,
	FinancialModelDocument,
	ProjectionPath,
} from "../types/model";

const document = {
	accounts: [],
	postings: [],
} as unknown as FinancialModelDocument;
const path = {
	rows: [],
	movementEvents: [],
	effectiveDocument: document,
	projectionStartDate: "2026-01-01",
	projectionEndDate: "2027-01-01",
} satisfies ProjectionPath;

function countingDefinition(
	options: { throwOnEvaluate?: boolean; failOnEndDate?: string } = {},
): EvaluationDefinition<number, number, { total: number }, number> {
	return {
		type: "netWorthThreshold",
		label: "Counting",
		validateConfig(config) {
			if (typeof config !== "number") throw new Error("Expected a number.");
			return config;
		},
		evaluatePath(_context, config) {
			if (
				options.throwOnEvaluate ||
				_context.path.projectionEndDate === options.failOnEndDate
			) {
				throw new Error("Evaluator failed.");
			}
			return config;
		},
		createAccumulator() {
			return { total: 0 };
		},
		accumulate(accumulator, result) {
			accumulator.total += result;
		},
		finalize(accumulator) {
			return accumulator.total;
		},
		status() {
			return "indeterminate";
		},
	};
}

function testTables(
	evaluations: EvaluationInstance<unknown>[],
): EvaluationTables {
	return {
		financialIndependence: [],
		netWorthThreshold: evaluations,
		postingFulfillment: [],
	} as unknown as EvaluationTables;
}

function resultFor(runtimes: EvaluationRuntimeSet, instanceId: string) {
	return runtimes
		.result()
		.evaluations.netWorthThreshold.find(
			(evaluation) => evaluation.instanceId === instanceId,
		);
}

describe("evaluation registry and runtime", () => {
	it("rejects duplicate definition IDs", () => {
		const registry = new EvaluationRegistry();
		registry.register(countingDefinition());
		expect(() => registry.register(countingDefinition())).toThrow(
			/already registered/,
		);
	});

	it("rejects maps and functions at the JSON boundary", () => {
		expect(isJsonValue(new Map())).toBe(false);
		expect(isJsonValue({ callback: () => true })).toBe(false);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(isJsonValue(cyclic)).toBe(false);
	});

	it("preserves order and runs multiple instances of one definition", () => {
		const registry = new EvaluationRegistry();
		registry.register(countingDefinition());
		const runtimes = new EvaluationRuntimeSet(
			testTables([
				{
					instanceId: "second",
					label: "Second",
					enabled: true,
					config: 2,
				},
				{
					instanceId: "first",
					label: "First",
					enabled: true,
					config: 1,
				},
			]),
			registry,
		);
		runtimes.evaluateDeterministic({ path, document });
		expect(
			runtimes
				.result()
				.evaluations.netWorthThreshold.map(
					(evaluation) => evaluation.instanceId,
				),
		).toEqual(["second", "first"]);
		expect(resultFor(runtimes, "second")?.deterministic).toBe(2);
		expect(resultFor(runtimes, "first")?.deterministic).toBe(1);
	});

	it("isolates disabled, duplicate, and invalid instances", () => {
		const registry = new EvaluationRegistry();
		registry.register(countingDefinition());
		const runtimes = new EvaluationRuntimeSet(
			testTables([
				{
					instanceId: "healthy",
					label: "Healthy",
					enabled: true,
					config: 3,
				},
				{
					instanceId: "disabled",
					label: "Disabled",
					enabled: false,
					config: 1,
				},
				{
					instanceId: "invalid",
					label: "Invalid",
					enabled: true,
					config: "bad",
				},
				{
					instanceId: "duplicate",
					label: "Duplicate A",
					enabled: true,
					config: 1,
				},
				{
					instanceId: "duplicate",
					label: "Duplicate B",
					enabled: true,
					config: 2,
				},
			]),
			registry,
		);
		runtimes.evaluateDeterministic({ path, document });
		const result = runtimes.result();
		expect(resultFor(runtimes, "healthy")?.deterministic).toBe(3);
		expect(resultFor(runtimes, "disabled")?.diagnostics[0]?.code).toBe(
			"evaluation-disabled",
		);
		expect(resultFor(runtimes, "invalid")?.diagnostics[0]?.code).toBe(
			"invalid-evaluation-config",
		);
		expect(resultFor(runtimes, "duplicate")?.diagnostics[0]?.code).toBe(
			"duplicate-evaluation-instance-id",
		);
		expect(
			result.evaluations.netWorthThreshold.filter(
				(evaluation) => evaluation.instanceId === "duplicate",
			),
		).toHaveLength(1);
	});

	it("isolates evaluator failures", () => {
		const registry = new EvaluationRegistry([
			countingDefinition({ throwOnEvaluate: true }),
		]);
		const runtimes = new EvaluationRuntimeSet(
			testTables([
				{ instanceId: "throws", label: "Throws", enabled: true, config: 1 },
			]),
			registry,
		);
		runtimes.evaluateDeterministic({ path, document });
		expect(resultFor(runtimes, "throws")?.diagnostics[0]?.code).toBe(
			"evaluation-runtime-error",
		);
	});

	it("uses the same generic lifecycle for partial and final stochastic results", () => {
		const registry = new EvaluationRegistry();
		registry.register(countingDefinition());
		const runtimes = new EvaluationRuntimeSet(
			testTables([
				{
					instanceId: "counter",
					label: "Counter",
					enabled: true,
					config: 2,
				},
			]),
			registry,
		);
		runtimes.evaluateDeterministic({ path, document });
		runtimes.startStochastic();
		runtimes.consume({ path, document });
		runtimes.finalize({
			document,
			deterministicPath: path,
			runCount: 1,
		});
		expect(resultFor(runtimes, "counter")?.probabilistic).toBe(2);
		runtimes.consume({ path, document });
		runtimes.finalize({
			document,
			deterministicPath: path,
			runCount: 2,
		});
		expect(resultFor(runtimes, "counter")?.probabilistic).toBe(4);
	});

	it("clears an earlier partial when a later stochastic path fails", () => {
		const registry = new EvaluationRegistry();
		registry.register(countingDefinition({ failOnEndDate: "2028-01-01" }));
		const runtimes = new EvaluationRuntimeSet(
			testTables([
				{
					instanceId: "late",
					label: "Late failure",
					enabled: true,
					config: 2,
				},
			]),
			registry,
		);
		runtimes.evaluateDeterministic({ path, document });
		runtimes.startStochastic();
		runtimes.consume({ path, document });
		runtimes.finalize({
			document,
			deterministicPath: path,
			runCount: 1,
		});
		expect(resultFor(runtimes, "late")?.probabilistic).toBe(2);
		runtimes.consume({
			path: { ...path, projectionEndDate: "2028-01-01" },
			document,
		});
		const failed = resultFor(runtimes, "late")!;
		expect(failed.status).toBe("warning");
		expect(failed.probabilistic).toBeNull();
	});

	it("never exposes probabilistic data from a failed envelope", () => {
		const collection: EvaluationResultCollection = {
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [
					{
						instanceId: "failed",
						label: "Failed",
						status: "warning",
						deterministic: { reached: true, firstReachedDate: "2026-01-01" },
						probabilistic: {
							probability: 1,
							p10ReachedDate: "2026-01-01",
							medianReachedDate: "2026-01-01",
							p90ReachedDate: "2026-01-01",
						},
						diagnostics: [],
					},
				],
				postingFulfillment: [],
			},
		};
		expect(getNetWorthThresholdResult(collection)).toBeNull();
		expect(
			getNetWorthThresholdResult(collection, "failed")?.probabilistic,
		).toBeNull();
	});
});

describe("configured evaluation integration", () => {
	it("projects two simultaneous threshold instances independently", () => {
		const { data: loadedDocument } = parseCsvFinancialModel(validCsvFiles);
		if (!loadedDocument) throw new Error("Document failed to load.");
		const result = projectFinancialModelDocument(
			loadedDocument,
			makeSettings({
				evaluations: {
					financialIndependence: [],
					netWorthThreshold: [
						{
							instanceId: "low",
							label: "Low",
							enabled: true,
							config: { target: 1 },
						},
						{
							instanceId: "high",
							label: "High",
							enabled: true,
							config: { target: 1_000_000_000 },
						},
					],
					postingFulfillment: [],
				},
			}),
		);
		expect(
			getNetWorthThresholdResult(result, "low")?.deterministic?.reached,
		).toBe(true);
		expect(
			getNetWorthThresholdResult(result, "high")?.deterministic?.reached,
		).toBe(false);
	});

	it("selects healthy FI and threshold instances after disabled and invalid ones", () => {
		const { data: loadedDocument } = parseCsvFinancialModel(validCsvFiles);
		if (!loadedDocument) throw new Error("Document failed to load.");
		const defaults = makeSettings().evaluations;
		const fi = defaults.financialIndependence[0];
		const threshold = defaults.netWorthThreshold[0];
		if (!fi || !threshold) throw new Error("Missing default evaluations.");
		const evaluations = {
			financialIndependence: [
				{ ...fi, instanceId: "fi-disabled", enabled: false },
				{ ...fi, instanceId: "fi-invalid", config: null },
				{ ...fi, instanceId: "fi-duplicate" },
				{ ...fi, instanceId: "fi-duplicate" },
				{ ...fi, instanceId: "fi-healthy" },
			],
			netWorthThreshold: [
				{ ...threshold, instanceId: "target-disabled", enabled: false },
				{ ...threshold, instanceId: "target-invalid", config: null },
				{ ...threshold, instanceId: "target-duplicate" },
				{ ...threshold, instanceId: "target-duplicate" },
				{ ...threshold, instanceId: "target-healthy" },
			],
			postingFulfillment: [],
		} as unknown as EvaluationTables;
		const result = projectFinancialModelDocument(
			loadedDocument,
			makeSettings({ evaluations }),
		);
		expect(getFinancialIndependenceResult(result)?.instanceId).toBe(
			"fi-healthy",
		);
		expect(getNetWorthThresholdResult(result)?.instanceId).toBe(
			"target-healthy",
		);
		expect(
			getFinancialIndependenceConfig(evaluations, result)?.instanceId,
		).toBe("fi-healthy");
		expect(getNetWorthThresholdConfig(evaluations, result)?.instanceId).toBe(
			"target-healthy",
		);
		expect(
			getNetWorthThresholdResult(result, "target-invalid")?.instanceId,
		).toBe("target-invalid");
	});

	it("keeps FI output when an enabled source is disabled by overrides", () => {
		const { data: loadedDocument } = parseCsvFinancialModel(validCsvFiles);
		if (!loadedDocument) throw new Error("Document failed to load.");
		const defaults = makeSettings().evaluations;
		const fi = defaults.financialIndependence[0];
		if (!fi || typeof fi.config !== "object" || fi.config === null) {
			throw new Error("Missing FI evaluation.");
		}
		const settings = makeSettings({
			evaluations: {
				financialIndependence: [
					{
						...fi,
						config: {
							...fi.config,
							sources: [
								{ type: "cashflow", postingId: "salary", included: true },
								{ type: "cashflow", postingId: "deleted", included: false },
							],
							continuingPostingIds: ["deleted"],
						},
					},
				],
				netWorthThreshold: [],
				postingFulfillment: [],
			},
		});
		const result = projectFinancialModelDocument(loadedDocument, settings, {
			addedAccounts: [],
			addedPostings: [],
			disabledAccountIds: [],
			disabledPostingIds: ["salary"],
		});
		const envelope = getFinancialIndependenceResult(result);
		expect(envelope?.deterministic).not.toBeNull();
		expect(envelope?.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing-financial-independence-source",
					relatedPostingIds: ["salary"],
				}),
			]),
		);
		expect(envelope?.diagnostics).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ relatedPostingIds: ["deleted"] }),
			]),
		);
	});

	it("keeps settings and results structured-clone and JSON safe", () => {
		const { data: loadedDocument } = parseCsvFinancialModel(validCsvFiles);
		if (!loadedDocument) throw new Error("Document failed to load.");
		const settings = makeSettings();
		const result = projectFinancialModelDocument(loadedDocument, settings);
		expect(structuredClone(settings)).toEqual(settings);
		expect(structuredClone(result)).toEqual(result);
		expect(() => JSON.stringify({ settings, result })).not.toThrow();
		expect(JSON.stringify(result)).not.toContain("Map");
	});
});
