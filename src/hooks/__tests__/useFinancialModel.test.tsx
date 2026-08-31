// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
	FinancialModelRepository,
	IncomeDataSource,
} from "@/lib/projection";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import {
	FINANCIAL_MODEL_QUERY_KEY,
	useFinancialModelMutation,
	useFinancialModelQuery,
	useFinancialModelResetMutation,
} from "../useFinancialModel";
import { useIncomeDataQuery } from "../useIncomeData";

describe("useFinancialModelQuery", () => {
	it("loads a document under the neutral query key", async () => {
		const document = createBaseDocument();
		const repository: FinancialModelRepository = {
			repositoryType: "test",
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

		const hook = renderHook(() => useFinancialModelQuery(repository), {
			wrapper,
		});

		await waitFor(() =>
			expect(hook.result.current.data?.document).toBe(document),
		);
		expect(repository.loadDocument).toHaveBeenCalledOnce();
		expect(queryClient.getQueryData(FINANCIAL_MODEL_QUERY_KEY)).toEqual({
			document,
			issues: [],
		});
	});
});

describe("useFinancialModelMutation", () => {
	it("rejects resolved save results containing validation errors", async () => {
		const document = createBaseDocument();
		const repository: FinancialModelRepository = {
			repositoryType: "test",
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
		const hook = renderHook(() => useFinancialModelMutation(repository), {
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

describe("useFinancialModelResetMutation", () => {
	it("refetches the active income snapshot after resetting the model", async () => {
		const document = createBaseDocument();
		const repository: FinancialModelRepository = {
			repositoryType: "test",
			label: "Test",
			description: "Test source",
			loadDocument: vi.fn(async () => ({ document, issues: [] })),
			reset: {
				label: "Reset",
				description: "Reset",
				run: vi.fn(async () => ({ document, issues: [] })),
			},
		};
		const incomeDataSource: IncomeDataSource = {
			sourceType: "test",
			label: "Test income",
			description: "Test income",
			load: vi.fn(async () => ({
				data: { incomeSources: [], taxProfiles: [] },
				issues: [],
			})),
		};
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const hook = renderHook(
			() => ({
				income: useIncomeDataQuery(incomeDataSource),
				reset: useFinancialModelResetMutation(repository),
			}),
			{ wrapper },
		);
		await waitFor(() =>
			expect(hook.result.current.income.isSuccess).toBe(true),
		);

		await act(async () => {
			await hook.result.current.reset.mutateAsync();
		});

		await waitFor(() => expect(incomeDataSource.load).toHaveBeenCalledTimes(2));
	});
});
