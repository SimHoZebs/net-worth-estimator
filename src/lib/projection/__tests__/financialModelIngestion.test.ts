import { describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "../__fixtures__";
import {
	createFinancialModelRecord,
	type FinancialModelDao,
	type FinancialModelDaoRead,
	FinancialModelIngestionCoordinator,
	type FinancialModelSourceSnapshot,
	financialModelSourceRevision,
} from "../persistence/financialModelPersistence";

class MemoryFinancialModelDao implements FinancialModelDao {
	constructor(public current: FinancialModelDaoRead = { status: "absent" }) {}

	async read() {
		return this.current;
	}

	async replace(record: Parameters<FinancialModelDao["replace"]>[0]) {
		this.current = { status: "found", record };
	}

	async replaceIfVersion(
		expectedVersion: string | null,
		record: Parameters<FinancialModelDao["replace"]>[0],
	) {
		const version =
			this.current.status === "found" ? this.current.record.version : null;
		if (this.current.status === "corrupt" || version !== expectedVersion) {
			return false;
		}
		this.current = { status: "found", record };
		return true;
	}
}

function source(snapshot: FinancialModelSourceSnapshot) {
	return { load: vi.fn(async () => snapshot) };
}

describe("FinancialModelIngestionCoordinator", () => {
	it("ingests an absent source and records source provenance", async () => {
		const document = createBaseDocument();
		const dao = new MemoryFinancialModelDao();
		const ingestionSource = source({
			sourceId: "csv",
			revision: "one",
			result: { document, issues: [] },
		});

		const result = await new FinancialModelIngestionCoordinator(
			ingestionSource,
			dao,
		).synchronize();

		expect(result).toMatchObject({ document, changed: true });
		expect(dao.current).toMatchObject({
			status: "found",
			record: {
				provenance: { type: "source", sourceId: "csv", revision: "one" },
			},
		});
	});

	it("does not replace user-owned data or load the source", async () => {
		const document = createBaseDocument({ sourcePath: "user" });
		const dao = new MemoryFinancialModelDao({
			status: "found",
			record: createFinancialModelRecord(document, { type: "user" }),
		});
		const ingestionSource = source({
			sourceId: "csv",
			revision: "changed",
			result: { document: createBaseDocument(), issues: [] },
		});

		const result = await new FinancialModelIngestionCoordinator(
			ingestionSource,
			dao,
		).synchronize();

		expect(result).toMatchObject({ document, changed: false });
		expect(ingestionSource.load).not.toHaveBeenCalled();
	});

	it("replaces source-owned data when its semantic revision changes", async () => {
		const previous = createBaseDocument({ sourcePath: "old" });
		const next = createBaseDocument({ sourcePath: "new" });
		const dao = new MemoryFinancialModelDao({
			status: "found",
			record: createFinancialModelRecord(previous, {
				type: "source",
				sourceId: "csv",
				revision: "old",
			}),
		});

		const result = await new FinancialModelIngestionCoordinator(
			source({
				sourceId: "csv",
				revision: "new",
				result: { document: next, issues: [] },
			}),
			dao,
		).synchronize();

		expect(result).toMatchObject({ document: next, changed: true });
	});

	it("preserves a concurrent user save when conditional replacement loses", async () => {
		const previous = createBaseDocument({ sourcePath: "old" });
		const user = createBaseDocument({ sourcePath: "user" });
		const dao = new MemoryFinancialModelDao({
			status: "found",
			record: createFinancialModelRecord(previous, {
				type: "source",
				sourceId: "csv",
				revision: "old",
			}),
		});
		const originalReplace = dao.replaceIfVersion.bind(dao);
		dao.replaceIfVersion = async (expected, record) => {
			await dao.replace(createFinancialModelRecord(user, { type: "user" }));
			return originalReplace(expected, record);
		};

		const result = await new FinancialModelIngestionCoordinator(
			source({
				sourceId: "csv",
				revision: "new",
				result: { document: createBaseDocument(), issues: [] },
			}),
			dao,
		).synchronize();

		expect(result).toMatchObject({ document: user, changed: false });
		expect(dao.current).toMatchObject({
			status: "found",
			record: { provenance: { type: "user" }, document: user },
		});
	});

	it("keeps the last valid source-owned model when changed input is invalid", async () => {
		const previous = createBaseDocument({ sourcePath: "old" });
		const record = createFinancialModelRecord(previous, {
			type: "source",
			sourceId: "csv",
			revision: "old",
		});
		const dao = new MemoryFinancialModelDao({ status: "found", record });
		const issue = {
			severity: "error" as const,
			code: "invalid",
			message: "Invalid source",
			path: [],
		};

		const result = await new FinancialModelIngestionCoordinator(
			source({
				sourceId: "csv",
				revision: "new",
				result: { document: createBaseDocument(), issues: [issue] },
			}),
			dao,
		).synchronize();

		expect(result).toEqual({
			document: previous,
			issues: [issue],
			changed: false,
		});
		expect(dao.current).toEqual({ status: "found", record });
	});

	it("does not let source paths affect semantic revisions", async () => {
		const left = createBaseDocument({ sourcePath: "/configs" });
		const right = createBaseDocument({ sourcePath: "/other/configs" });

		await expect(financialModelSourceRevision(left)).resolves.toBe(
			await financialModelSourceRevision(right),
		);
	});
});
