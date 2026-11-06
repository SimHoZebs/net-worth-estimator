import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { projectionFixture } from "../../mocks/projection.ts";
import { ProjectionChart } from "../ProjectionChart.tsx";
import { useOutlookProjection } from "../../pages/outlook/useOutlookProjection.ts";
import { useSavedAccounts } from "../../state/savedState.ts";
import { useCheckpoints } from "../../state/workspaceResources.ts";

vi.mock("../../pages/outlook/useOutlookProjection.ts", () => ({
	useOutlookProjection: vi.fn(),
}));

vi.mock("../../state/savedState.ts", () => ({
	useSavedAccounts: vi.fn(),
}));

const mockedAccounts = vi.mocked(useSavedAccounts);

vi.mock("../../state/workspaceResources.ts", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../../state/workspaceResources.ts")
	>()),
	useCheckpoints: vi.fn(),
}));

const mockedOutlookProjection = vi.mocked(useOutlookProjection);
const mockedCheckpoints = vi.mocked(useCheckpoints);

function mockChart(
	projection: ReturnType<typeof projectionFixture> | null,
	checkpoints: {
		observedAt: number;
		AccountId: string;
		Balance: number;
		source: string;
	}[] = [],
) {
	mockedOutlookProjection.mockReturnValue({
		base: projection,
		range: null,
		pending: false,
		loading: false,
		baseError: null,
		retryProjection: vi.fn(),
		status: "success",
	} as ReturnType<typeof useOutlookProjection>);
	mockedCheckpoints.mockReturnValue({
		data: { checkpoints },
	} as ReturnType<typeof useCheckpoints>);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// Sparse engine rows inside the trailing window expand into one daily point
// per day: 2026-06-02 holds $1,000 through 2026-06-19, $1,400 from 2026-06-20,
// and $1,800 on 2026-07-01.
async function show() {
	const onEvidence = vi.fn();
	mockChart(
		projectionFixture({
			points: [
				{ date: "2026-06-02", total: 1000, balances: {} },
				{ date: "2026-06-20", total: 1400, balances: {} },
				{ date: "2026-07-01", total: 1800, balances: {} },
			],
		}),
	);
	render(<ProjectionChart onEvidence={onEvidence} />);
	await screen.findByRole("img", {
		name: "Net worth over the trailing 30 days",
	});
	return { onEvidence };
}

function totalDescription(): string {
	const chart = screen.getByRole("img", {
		name: "Net worth over the trailing 30 days",
	});
	return chart.querySelector("desc")?.textContent ?? "";
}

describe("projection chart inspection", () => {
	it("keeps the first-sync delta fixed across window changes", () => {
		mockChart(
			projectionFixture({
				currentNetWorth: 1800,
				points: [
					{ date: "2026-01-01", total: 500, balances: {} },
					{ date: "2026-02-01", total: 1000, balances: {} },
					{ date: "2026-07-01", total: 1800, balances: {} },
					{ date: "2027-01-01", total: 9000, balances: {} },
				],
			}),
			[
				{
					observedAt: Date.parse("2026-02-01T09:00:00Z") / 1000,
					AccountId: "cash",
					Balance: 1000,
					source: "banksync",
				},
				{
					observedAt: Date.parse("2026-07-01T09:00:00Z") / 1000,
					AccountId: "cash",
					Balance: 1800,
					source: "banksync",
				},
			],
		);
		render(<ProjectionChart onEvidence={vi.fn()} />);
		expect(screen.getByText("+$800 (+80%)")).toBeTruthy();
		expect(screen.getByText("since first sync · Feb 1, 2026")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "90 days" }));
		expect(screen.getByText("+$800 (+80%)")).toBeTruthy();
		expect(screen.getByText("As of Jul 1, 2026")).toBeTruthy();
	});

	it.each([
		[800, "-$200 (-20%)"],
		[1000, "$0 (0%)"],
	])(
		"shows signed and unchanged deltas for current worth %s",
		(currentNetWorth, label) => {
			mockChart(projectionFixture({ currentNetWorth }), [
				{
					observedAt: Date.parse("2026-01-01T09:00:00Z") / 1000,
					AccountId: "cash",
					Balance: 1000,
					source: "banksync",
				},
			]);
			render(<ProjectionChart onEvidence={vi.fn()} />);
			expect(screen.getByText(label)).toBeTruthy();
		},
	);

	it("hides the sync comparison until a synced baseline exists", async () => {
		await show();
		expect(screen.queryByText(/since first sync/)).toBeNull();
	});

	it("renders the trailing window as an accessible TanStack chart", async () => {
		await show();
		const chart = screen.getByRole("img", {
			name: "Net worth over the trailing 30 days",
		});
		expect(chart.getAttribute("tabindex")).toBe("0");
		expect(totalDescription()).toContain(
			"Trailing 30-day net worth ends at $1,800 on Jul 1, 2026",
		);
		expect(totalDescription()).toContain("starting at $1,000 on Jun 2, 2026");
		expect(totalDescription()).toContain("The solid $0 line marks no debt.");
	});

	it("opens the evidence action from the graph", async () => {
		const { onEvidence } = await show();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Inspect current net worth evidence",
			}),
		);
		expect(onEvidence).toHaveBeenCalledOnce();
	});

	it("switches between 30-day and 90-day windows", async () => {
		await show();
		expect(
			screen.getByRole("img", {
				name: "Net worth over the trailing 30 days",
			}),
		).toBeTruthy();
		expect(totalDescription()).toContain("Trailing 30-day net worth");
		fireEvent.click(screen.getByRole("button", { name: "90 days" }));
		expect(
			screen.getByRole("img", {
				name: "Net worth over the trailing 90 days",
			}),
		).toBeTruthy();
		const long = screen
			.getByRole("img", { name: "Net worth over the trailing 90 days" })
			.querySelector("desc")?.textContent;
		expect(long).toContain("Trailing 90-day net worth");
		expect(long).toContain("starting at $1,000 on Apr 3, 2026");
		fireEvent.click(screen.getByRole("button", { name: "30 days" }));
		expect(
			screen.getByRole("img", {
				name: "Net worth over the trailing 30 days",
			}),
		).toBeTruthy();
	});

	it("hides the $0 line for an all-debt window", async () => {
		mockChart(
			projectionFixture({
				points: [
					{ date: "2026-06-10", total: -66200, balances: {} },
					{ date: "2026-07-01", total: -65800, balances: {} },
				],
			}),
		);
		const { container } = render(<ProjectionChart onEvidence={vi.fn()} />);
		await screen.findByRole("img", {
			name: "Net worth over the trailing 30 days",
		});
		const desc =
			container.querySelector("svg.ts-chart desc")?.textContent ?? "";
		// The accessible description carries the zero-line decision, so the
		// assertion stays on project-owned text, not chart internals.
		expect(desc).not.toContain("$0 line");
		expect(desc).toContain("-$65,800");
	});

	it("toggles between the total line and the account stack", async () => {
		mockedAccounts.mockReturnValue(financialModelFixture.accounts);
		mockChart(
			projectionFixture({
				points: [
					{
						date: "2026-06-02",
						total: 600,
						balances: { checking: 600, savings: 400, mortgage: -400 },
					},
					{
						date: "2026-07-01",
						total: 1000,
						balances: { checking: 800, savings: 600, mortgage: -400 },
					},
				],
			}),
		);
		render(<ProjectionChart onEvidence={vi.fn()} />);
		// The total line renders first as a TanStack chart.
		expect(
			await screen.findByRole("img", {
				name: "Net worth over the trailing 30 days",
			}),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
		// The stack replaces the line with its own accessible chart.
		expect(
			screen.queryByRole("img", {
				name: "Net worth over the trailing 30 days",
			}),
		).toBeNull();
		expect(
			await screen.findByRole("img", {
				name: "Net worth by account over the trailing window",
			}),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Total" }));
		expect(
			screen.getByRole("img", {
				name: "Net worth over the trailing 30 days",
			}),
		).toBeTruthy();
	});

	it("explains an account view with no per-account data", async () => {
		mockedAccounts.mockReturnValue(financialModelFixture.accounts);
		await show();
		fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
		expect(
			await screen.findByText("No per-account data in this window."),
		).toBeTruthy();
	});
});
