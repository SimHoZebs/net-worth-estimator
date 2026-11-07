import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import { setServerModelFixture } from "../mocks/workspace.ts";
import { resetServerQueryCache } from "../state/serverQuery.ts";
import { AccountDialog } from "./AccountDialog.tsx";

vi.mock("./analysis/TransactionAnalysis.tsx", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("./analysis/TransactionAnalysis.tsx")
	>()),
	TransactionAnalysisProvider: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
}));

const motion = vi.hoisted(() => ({ reorder: (_ids: string[]) => {} }));
vi.mock("motion/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("motion/react")>()),
	useDragControls: () => ({ start: vi.fn() }),
	Reorder: {
		Group: ({
			children,
			onReorder,
		}: {
			children: ReactNode;
			onReorder: (ids: string[]) => void;
		}) => {
			motion.reorder = onReorder;
			return <ul>{children}</ul>;
		},
		Item: ({ children }: { children: ReactNode }) => <li>{children}</li>,
	},
}));

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

const forecasts: string[] = [];
let cache: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	forecasts.length = 0;
	acceptTestResource();
	resetServerQueryCache();
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}));
	cache = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown) => {
			forecasts.push(String(url));
			throw new Error(`unexpected fetch: ${String(url)}`);
		}),
	);
});

function dialogProps() {
	const account = financialModelFixture.accounts[0]!;
	return {
		account,
		accounts: financialModelFixture.accounts,
		transactions: financialModelFixture.transactions,
		startDate: financialModelFixture.startDate,
		readOnly: false as const,
		onClose: () => {},
		onEdit: () => {},
	};
}

const projectionUrls = () =>
	forecasts.filter((url) => url.includes("projection"));

describe("finance-first account dialog", () => {
	it("opens recorded activity, recurring rules, and details without a forecast", () => {
		setServerModelFixture(financialModelFixture);
		render(<AccountDialog {...dialogProps()} />, { wrapper });
		// Recorded history renders by default with literal amounts.
		expect(
			screen.getAllByRole("button", { name: /View Household payroll/ }),
		).toHaveLength(3);
		expect(
			(screen.getByLabelText("Balance (USD)") as HTMLInputElement).value,
		).toBe("18250");
		// Recurring rules need no forecast.
		fireEvent.click(screen.getByRole("tab", { name: /Recurring/ }));
		expect(screen.getByText("Household take-home pay")).toBeTruthy();
		expect(projectionUrls()).toEqual([]);
		// Ordinary account details never auto-request a forecast.
		fireEvent.click(screen.getByRole("tab", { name: "Account details" }));
		expect(
			(screen.getByLabelText("Account name") as HTMLInputElement).value,
		).toBe("Everyday checking");
		expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
		expect(screen.queryByText("Account activity · Saved")).toBeNull();
		expect(screen.queryByRole("button", { name: "Load forecast" })).toBeNull();
		expect(screen.queryByText("Projection at horizon")).toBeNull();
		expect(projectionUrls()).toEqual([]);
	});

	it("keeps projected activity errors out of account details", async () => {
		setServerModelFixture(financialModelFixture);
		render(<AccountDialog {...dialogProps()} />, { wrapper });
		expect(projectionUrls()).toEqual([]);
		fireEvent.change(screen.getByLabelText("Transaction source"), {
			target: { value: "projected" },
		});
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Retry forecast" }),
			).toBeTruthy(),
		);
		expect(projectionUrls().length).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("tab", { name: "Account details" }));
		expect(screen.queryByRole("button", { name: "Load forecast" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry forecast" })).toBeNull();
		expect(screen.queryByText("Projection at horizon")).toBeNull();
		expect(screen.getByLabelText("Account name")).toBeTruthy();
	});
});
