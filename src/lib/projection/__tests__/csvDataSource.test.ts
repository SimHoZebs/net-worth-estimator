import { describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "../__fixtures__";
import { createCsvDataSource } from "../sources/csv/csvDataSource";

describe("createCsvDataSource", () => {
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
});
