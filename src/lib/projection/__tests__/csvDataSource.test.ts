import { describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "../__fixtures__";
import { createCsvDataSource } from "../sources/csv/csvDataSource";

describe("createCsvDataSource", () => {
	const invalidResponseError =
		"Invalid financial model API response: expected a valid FinancialModelParseResult payload.";

	it("uses the canonical financial model endpoint by default", async () => {
		const document = createBaseDocument();
		const fetchImpl = vi.fn(async () =>
			Response.json({ document, issues: [] }),
		);
		const dataSource = createCsvDataSource({ fetchImpl });

		await dataSource.loadDocument();
		await dataSource.save?.run(document);

		expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/financial-model");
		expect(fetchImpl).toHaveBeenNthCalledWith(
			2,
			"/api/financial-model",
			expect.objectContaining({ method: "PUT" }),
		);
	});

	it.each([
		["a non-object payload", null],
		["a partial envelope", { document: null }],
		["a wrong issues type", { document: null, issues: {} }],
		[
			"a partial document",
			{ document: { sourcePath: "/configs", accounts: [] }, issues: [] },
		],
		[
			"a wrong nested document type",
			{
				document: {
					...createBaseDocument(),
					accounts: [{ ...createBaseDocument().accounts[0], enabled: "true" }],
				},
				issues: [],
			},
		],
		[
			"a malformed validation issue",
			{
				document: null,
				issues: [
					{ code: "server.load", message: "Failed", path: [], severity: 1 },
				],
			},
		],
	])("rejects %s from the load API", async (_description, payload) => {
		const fetchImpl = vi.fn(async () => Response.json(payload));

		await expect(
			createCsvDataSource({ fetchImpl }).loadDocument(),
		).rejects.toThrow(invalidResponseError);
	});

	it("rejects an invalid response from the save API", async () => {
		const document = createBaseDocument();
		const fetchImpl = vi.fn(async () =>
			Response.json({ document, issues: [{ severity: "error" }] }),
		);

		await expect(
			createCsvDataSource({ fetchImpl }).save?.run(document),
		).rejects.toThrow(invalidResponseError);
	});

	it("rejects malformed JSON with the API boundary error", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response("{", {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(
			createCsvDataSource({ fetchImpl }).loadDocument(),
		).rejects.toThrow(invalidResponseError);
	});
});
