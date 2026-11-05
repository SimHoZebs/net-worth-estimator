import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "../../mocks/fetch.ts";
import {
	ServerQueryWrapper,
	setupQueryScope,
	teardownQueryScope,
} from "../../mocks/testScope.tsx";
import { AmountCatalog } from "./AmountCatalog.tsx";

beforeEach(() => {
	setupQueryScope();
});
afterEach(() => {
	teardownQueryScope();
	vi.restoreAllMocks();
});

it("starts the amount presets query when the amounts view mounts", async () => {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown) => {
			const path = String(url);
			calls.push(path);
			if (path.endsWith("/v1/amount-presets")) return ok({ presets: [] });
			if (path.endsWith("/v1/amount-resolvers"))
				return ok({ resolvers: [], providers: [] });
			if (path.endsWith("/v1/accounts/balances"))
				return ok({ accounts: [], asOf: "", revision: null });
			if (path.endsWith("/v1/transactions/catalog"))
				return ok({ items: [], revision: null });
			throw new Error(`Unexpected test API call: ${path}`);
		}),
	);
	render(
		<ServerQueryWrapper>
			<AmountCatalog />
		</ServerQueryWrapper>,
	);
	await waitFor(() =>
		expect(calls.some((path) => path.endsWith("/v1/amount-presets"))).toBe(
			true,
		),
	);
});
