// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "@/lib/projection";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import {
	FINANCIAL_MODEL_QUERY_KEY,
	useFinancialModelMutation,
	useFinancialModelQuery,
} from "../useFinancialModel";
import {
	SCENARIO_QUERY_KEY,
	useScenarioMutation,
	useScenarioQuery,
	useScenarioResetMutation,
} from "../useScenario";

describe("useFinancialModelQuery", () => {
	it("loads a document under the neutral query key", async () => {
		const document = createBaseDocument();
		const dataSource: DataSource = {
			sourceType: "test",
			label: "Test",
			description: "Test source",
			loadDocument: vi.fn(async () => ({ document, issues: [] })),
		};
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);

		const hook = renderHook(() => useFinancialModelQuery(dataSource), {
			wrapper,
		});

		await waitFor(() =>
			expect(hook.result.current.data?.document).toBe(document),
		);
		expect(dataSource.loadDocument).toHaveBeenCalledOnce();
		expect(queryClient.getQueryData(FINANCIAL_MODEL_QUERY_KEY)).toEqual({
			document,
			issues: [],
		});
	});
});

describe("legacy scenario hooks", () => {
	it("preserves the pack envelope and legacy query key", async () => {
		const document = createBaseDocument();
		const dataSource: DataSource = {
			sourceType: "test",
			label: "Test",
			description: "Test source",
			loadDocument: vi.fn(async () => ({ document, issues: [] })),
		};
		const queryClient = new QueryClient();
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);

		const hook = renderHook(() => useScenarioQuery(dataSource), { wrapper });

		await waitFor(() => expect(hook.result.current.data?.pack).toBe(document));
		expect(queryClient.getQueryData(SCENARIO_QUERY_KEY)).toEqual({
			pack: document,
			issues: [],
		});
		expect(queryClient.getQueryData(FINANCIAL_MODEL_QUERY_KEY)).toBeUndefined();
	});

	it("adapts mutation and reset results to pack envelopes", async () => {
		const document = createBaseDocument();
		const dataSource: DataSource = {
			sourceType: "test",
			label: "Test",
			description: "Test source",
			loadDocument: vi.fn(async () => ({ document, issues: [] })),
			save: {
				label: "Save",
				description: "Save",
				run: vi.fn(async () => ({ document, issues: [] })),
			},
			reset: {
				label: "Reset",
				description: "Reset",
				run: vi.fn(async () => ({ document, issues: [] })),
			},
		};
		const queryClient = new QueryClient();
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const mutation = renderHook(() => useScenarioMutation(dataSource), {
			wrapper,
		});
		const reset = renderHook(() => useScenarioResetMutation(dataSource), {
			wrapper,
		});

		await act(async () => {
			await expect(
				mutation.result.current.mutateAsync(document),
			).resolves.toEqual({
				pack: document,
				issues: [],
			});
			await expect(reset.result.current.mutateAsync()).resolves.toEqual({
				pack: document,
				issues: [],
			});
		});
		expect(queryClient.getQueryData(SCENARIO_QUERY_KEY)).toEqual({
			pack: document,
			issues: [],
		});
	});
});

describe("useFinancialModelMutation", () => {
	it("rejects resolved save results containing validation errors", async () => {
		const document = createBaseDocument();
		const dataSource: DataSource = {
			sourceType: "test",
			label: "Test",
			description: "Test source",
			loadDocument: vi.fn(async () => ({ document, issues: [] })),
			save: {
				label: "Save",
				description: "Save",
				run: vi.fn(async () => ({
					document,
					issues: [
						{
							severity: "error" as const,
							code: "invalid",
							message: "No",
							path: [],
						},
					],
				})),
			},
		};
		const queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const hook = renderHook(() => useFinancialModelMutation(dataSource), {
			wrapper,
		});

		await act(async () => {
			await expect(hook.result.current.mutateAsync(document)).rejects.toThrow(
				"validation errors",
			);
		});
		expect(hook.result.current.isSuccess).toBe(false);
	});
});
