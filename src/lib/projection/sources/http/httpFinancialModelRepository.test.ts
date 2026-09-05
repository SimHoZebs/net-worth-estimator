import { describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import {
	createHttpFinancialModelRepository,
	fetchServerStatus,
	withoutWriteCapabilities,
} from "./httpFinancialModelRepository";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("fetchServerStatus", () => {
	it("returns the server flags", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ readOnly: true, authEnabled: false }),
		) as unknown as typeof fetch;
		await expect(fetchServerStatus(fetchImpl, "/v1/status")).resolves.toEqual({
			readOnly: true,
			authEnabled: false,
		});
	});

	it("treats missing flags as false", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({}),
		) as unknown as typeof fetch;
		await expect(fetchServerStatus(fetchImpl, "/v1/status")).resolves.toEqual({
			readOnly: false,
			authEnabled: false,
		});
	});

	it("throws on non-OK responses", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({}, 500),
		) as unknown as typeof fetch;
		await expect(fetchServerStatus(fetchImpl, "/v1/status")).rejects.toThrow(
			"(500)",
		);
	});
});

describe("withoutWriteCapabilities", () => {
	it("strips save and reset while keeping reads", () => {
		const repository = createHttpFinancialModelRepository({
			fetchImpl: (async () => jsonResponse({})) as unknown as typeof fetch,
		});
		expect(repository.save).toBeDefined();

		const stripped = withoutWriteCapabilities(repository);
		expect(stripped.save).toBeUndefined();
		expect(stripped.reset).toBeUndefined();
		expect(stripped.loadDocument).toBe(repository.loadDocument);
		expect(stripped.label).toBe(repository.label);
	});
});

describe("save authorization", () => {
	it("sends the bearer token when signed in", async () => {
		let capturedInit: RequestInit | undefined;
		const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
			capturedInit = init;
			return jsonResponse({ document: null, issues: [] });
		}) as unknown as typeof fetch;
		const repository = createHttpFinancialModelRepository({
			fetchImpl,
			getAuthToken: () => "secret-token",
		});

		await repository.save?.run(createBaseDocument());

		expect(capturedInit?.headers).toMatchObject({
			Authorization: "Bearer secret-token",
		});
	});

	it("omits the header when signed out", async () => {
		let capturedInit: RequestInit | undefined;
		const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
			capturedInit = init;
			return jsonResponse({ document: null, issues: [] });
		}) as unknown as typeof fetch;
		const repository = createHttpFinancialModelRepository({
			fetchImpl,
			getAuthToken: () => null,
		});

		await repository.save?.run(createBaseDocument());

		expect(capturedInit?.headers ?? {}).not.toHaveProperty("Authorization");
	});

	it("maps 401 and 403 to actionable messages", async () => {
		for (const [status, fragment] of [
			[401, "access token"],
			[403, "read-only"],
		] as const) {
			const fetchImpl = (async () =>
				jsonResponse({}, status)) as unknown as typeof fetch;
			const repository = createHttpFinancialModelRepository({ fetchImpl });
			await expect(repository.save?.run(createBaseDocument())).rejects.toThrow(
				fragment,
			);
		}
	});
});
