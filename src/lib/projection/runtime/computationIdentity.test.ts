import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument, makeSettings } from "../__fixtures__";
import {
	diffComputationSummaries,
	formatComputationSummary,
	identityPrefix,
	logRecalculation,
	summarizeComputation,
} from "./computationIdentity";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("summarizeComputation", () => {
	it("counts rows and flags income data", () => {
		const summary = summarizeComputation({
			document: createBaseDocument(),
			settings: makeSettings(),
		});
		expect(summary.accounts).toBe(createBaseDocument().accounts.length);
		expect(summary.postings).toBe(createBaseDocument().postings.length);
		expect(summary.horizonYears).toBe(makeSettings().horizonYears);
		expect(summary.incomeData).toBe(false);
	});

	it("marks income data presence", () => {
		const summary = summarizeComputation({
			document: null,
			settings: makeSettings(),
			incomeData: { sources: [] } as never,
		});
		expect(summary.accounts).toBe(0);
		expect(summary.incomeData).toBe(true);
	});
});

describe("diffComputationSummaries", () => {
	const base = () =>
		summarizeComputation({
			document: createBaseDocument(),
			settings: makeSettings(),
			extra: { runCount: 100, seed: 1 },
		});

	it("is empty for identical summaries", () => {
		expect(diffComputationSummaries(base(), base())).toEqual([]);
	});

	it("names the facets that moved", () => {
		const next = {
			...base(),
			horizonYears: 30,
			extra: "changed",
		};
		expect(diffComputationSummaries(base(), next).sort()).toEqual([
			"extra",
			"horizonYears",
		]);
	});
});

describe("formatComputationSummary", () => {
	it("renders one key=value line", () => {
		const line = formatComputationSummary(
			summarizeComputation({
				document: createBaseDocument(),
				settings: makeSettings(),
			}),
		);
		expect(line).toMatch(/accounts=\d+ postings=\d+ .*horizon=1/);
	});
});

describe("identityPrefix", () => {
	it("is a stable 8-hex fingerprint", () => {
		expect(identityPrefix("abc")).toBe(identityPrefix("abc"));
		expect(identityPrefix("abc")).toMatch(/^[0-9a-f]{8}$/);
		expect(identityPrefix("abc")).not.toBe(identityPrefix("abd"));
	});
});

describe("logRecalculation", () => {
	it("funnels through console.debug with a projection tag", () => {
		const debug = vi.fn();
		vi.stubGlobal("console", { ...console, debug });
		logRecalculation("stochastic recalculation", {
			identity: "deadbeef",
			changed: "runCount",
		});
		expect(debug).toHaveBeenCalledOnce();
		expect(debug.mock.calls[0]?.[0]).toContain("[projection]");
		expect(debug.mock.calls[0]?.[0]).toContain("changed=runCount");
	});
});
