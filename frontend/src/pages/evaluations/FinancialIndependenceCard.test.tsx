import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	detailedIndependenceOutcome,
	independenceConfig,
	independenceEnvelope,
	independenceItem,
	independenceRow,
} from "@/mocks/financialIndependence.ts";
import { FinancialIndependenceCard } from "./FinancialIndependenceCard.tsx";
import { stubMatchMedia } from "@/mocks/testScope.tsx";

// Focus, dismissal, and responsive framing use the real shared Drawer in browser tests.
vi.mock("@/components/Drawer.tsx", () => ({
	Drawer: ({
		label,
		children,
		onClose,
	}: {
		label: string;
		children: ReactNode;
		onClose: () => void;
	}) => (
		<section role="dialog" aria-label={label}>
			<button type="button" onClick={onClose}>
				Close dialog
			</button>
			{children}
		</section>
	),
}));

beforeEach(() => {
	stubMatchMedia(false);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function openInspector(view: ReturnType<typeof render>) {
	fireEvent.click(
		view.getByRole("button", {
			name: "Inspect independence for Financial independence",
		}),
	);
	return within(view.getByRole("dialog", { name: "Financial independence" }));
}

describe("FinancialIndependenceCard", () => {
	it("presents financial outcomes without exposing engine screening gates", () => {
		const item = independenceItem(
			independenceEnvelope({
				rows: [independenceRow("2036-02-01", { minimumNetWorth: 0 })],
			}),
		);
		const view = render(<FinancialIndependenceCard item={item} />);
		expect(view.getByText("Not reached")).toBeTruthy();
		expect(view.queryByRole("button", { name: /Inspect evidence/ })).toBeNull();
		const dialog = openInspector(view);
		expect(dialog.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Overview",
			"Configure",
		]);
		expect(dialog.getByText("Funding as of Feb 2036")).toBeTruthy();
		expect(
			dialog.getByRole("table", {
				name: "Selected financial independence funding sources",
			}),
		).toBeTruthy();
		expect(
			dialog.getByRole("table", {
				name: "Financial independence funding over time",
			}),
		).toBeTruthy();
		expect(
			dialog.queryByRole("region", { name: "Financial independence checks" }),
		).toBeNull();
		expect(
			dialog.queryByText(
				/Net-worth minimum|Funding insufficient|Start value preserved/,
			),
		).toBeNull();
		expect(
			dialog.queryByText(
				/Net-worth minimum|Minimum met|Not tested|Not sustained/,
			),
		).toBeNull();
		expect(dialog.queryByRole("columnheader", { name: "Test" })).toBeNull();
		fireEvent.click(dialog.getByRole("tab", { name: "Configure" }));
		expect(dialog.getByText("Configuration unavailable.")).toBeTruthy();
	});

	it("keeps the card compact and opens financial evidence without expanding it", () => {
		const view = render(
			<FinancialIndependenceCard item={independenceItem()} />,
		);
		const card = view.getByRole("region", { name: "Financial independence" });
		expect(
			view.getByRole("img", { name: /Spending coverage at Feb 2036/ }),
		).toBeTruthy();
		expect(view.queryByRole("slider")).toBeNull();
		expect(view.queryByRole("table")).toBeNull();
		const dialog = openInspector(view);
		expect(
			dialog
				.getByRole("tab", { name: "Overview" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(dialog.getByText("Funding as of Feb 2036")).toBeTruthy();
		expect(dialog.getAllByText("$20,000", { exact: true })).toHaveLength(2);
		expect(dialog.queryByText("Not reached")).toBeNull();
		expect(within(card).queryByRole("table")).toBeNull();
		expect(
			dialog.getByRole("table", {
				name: "Selected financial independence funding sources",
			}),
		).toBeTruthy();
		expect(dialog.getByRole("rowheader", { name: "Cash" })).toBeTruthy();
		const cashAccount = dialog.getByRole("button", { name: "Cash" });
		fireEvent.click(cashAccount);
		expect(window.location.hash).toContain("#accounts/account/cash");
		window.location.hash = "#evaluations";
		fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
		expect(view.queryByRole("dialog")).toBeNull();
		expect(view.queryByRole("table")).toBeNull();
	});

	it("keeps the automatic evidence date without date controls", () => {
		const view = render(
			<FinancialIndependenceCard item={independenceItem()} />,
		);
		const dialog = openInspector(view);
		expect(dialog.getByText("Funding as of Feb 2036")).toBeTruthy();
		expect(dialog.queryByRole("combobox")).toBeNull();
		fireEvent.click(dialog.getByText("Compare start dates"));
		expect(
			dialog.getByRole("img", {
				name: /Financial independence spending coverage/,
			}),
		).toBeTruthy();
		expect(dialog.queryByRole("slider")).toBeNull();
		expect(
			dialog.getByRole("heading", { name: "Funding sources · Feb 2036" }),
		).toBeTruthy();
		expect(
			dialog.getByRole("table", {
				name: "Financial independence funding over time",
			}),
		).toBeTruthy();
		expect(dialog.queryByRole("slider")).toBeNull();
	});

	it("uses the engine's detailed date when later financial summaries exist", () => {
		const item = independenceItem(
			independenceEnvelope({
				rows: [
					independenceRow("2026-02-01", {
						annualWithdrawalCapacity: 20000,
						totalAnnualCapacity: 40000,
						coverageRatio: 0.5,
					}),
					independenceRow(),
				],
				runOutcomes: [
					detailedIndependenceOutcome({ candidateDate: "2026-02-01" }),
				],
			}),
		);
		const view = render(<FinancialIndependenceCard item={item} />);
		const dialog = openInspector(view);
		expect(dialog.getByText("Funding as of Feb 2026")).toBeTruthy();
		expect(
			dialog.getAllByText("$40,000", { exact: true }).length,
		).toBeGreaterThanOrEqual(1);
		expect(
			dialog.getByRole("heading", { name: "Funding sources · Feb 2026" }),
		).toBeTruthy();
	});

	it("retains financial shortfalls, account limits, and projected assets", () => {
		const envelope = independenceEnvelope({
			rows: [
				independenceRow("2036-02-01", {
					isCovered: true,
					coverageRatio: 1.2,
					annualExpenseTarget: 50000,
				}),
			],
			runOutcomes: [detailedIndependenceOutcome()],
			milestones: {
				firstCoverageDate: "2036-02-01",
				firstSelfSustainingDate: null,
			},
		});
		const view = render(
			<FinancialIndependenceCard
				item={independenceItem(
					envelope,
					independenceConfig({ annualExpenseTarget: 50000 }),
				)}
			/>,
		);
		expect(view.getByText("Not reached")).toBeTruthy();
		const dialog = openInspector(view);
		expect(dialog.queryByText(/Self-sustaining ·/)).toBeNull();
		expect(
			dialog.getByRole("heading", {
				name: "First spending shortfall · Mar 1, 2040",
			}),
		).toBeTruthy();
		expect(dialog.getByText("$2,000.00")).toBeTruthy();
		expect(
			dialog.getByText("Protected account balance · Annual withdrawal limit"),
		).toBeTruthy();
		expect(
			dialog.getByRole("img", {
				name: /Projected assets if independence starts in Feb 2036/,
			}),
		).toBeTruthy();
		expect(dialog.getByText("$850,000")).toBeTruthy();
		expect(dialog.queryByText(/Passed|Failed|Principal|preserved/)).toBeNull();
	});

	it("distinguishes an insufficient projection horizon from financial failure", () => {
		const item = independenceItem(
			independenceEnvelope({ rows: [], runOutcomes: [], milestones: {} }),
			independenceConfig({ evaluationYears: 30 }),
		);
		const view = render(<FinancialIndependenceCard item={item} />);
		expect(view.getByText("More horizon needed")).toBeTruthy();
		expect(
			view
				.getByRole("progressbar", { name: "Available projection horizon" })
				.getAttribute("aria-valuenow"),
		).toBe("67");
		const dialog = openInspector(view);
		expect(
			dialog.getByRole("progressbar", { name: "Required assessment period" }),
		).toBeTruthy();
		expect(dialog.queryByRole("tab", { name: "Checks" })).toBeNull();
		expect(dialog.queryByRole("tab", { name: "Data" })).toBeNull();
		expect(
			dialog.queryByRole("img", { name: /^Annual spending at/ }),
		).toBeNull();
	});

	it("keeps source warnings visible and supports missing evidence and paused evaluations", () => {
		const envelope = independenceEnvelope(null);
		envelope.diagnostics = [
			{
				code: "missing-financial-independence-source",
				severity: "warning",
				message: "An enabled FI source is unavailable and was ignored.",
				relatedAccountIds: ["missing"],
			},
		];
		const item = independenceItem(envelope);
		const view = render(<FinancialIndependenceCard item={item} />);
		expect(view.getByText("Not calculated")).toBeTruthy();
		fireEvent.click(
			view.getByRole("button", { name: "1 source or configuration issue" }),
		);
		const dialog = within(view.getByRole("dialog"));
		expect(
			dialog.getByText(/A selected funding source is unavailable/),
		).toBeTruthy();
		expect(
			dialog.queryByRole("table", {
				name: "Selected financial independence funding sources",
			}),
		).toBeNull();
		view.rerender(
			<FinancialIndependenceCard item={{ ...item, enabled: false }} />,
		);
		expect(view.getByText("Paused")).toBeTruthy();
		expect(view.queryByRole("dialog")).toBeNull();
	});

	it("separates a self-sustaining base case from modeled scenario probability", () => {
		const envelope = independenceEnvelope({
			rows: [independenceRow()],
			runOutcomes: [],
			milestones: { firstSelfSustainingDate: "2036-02-01" },
		});
		const view = render(
			<FinancialIndependenceCard
				item={independenceItem(envelope)}
				range={{
					probability: 0.65,
					date: null,
					dateProbability: null,
					count: 400,
				}}
			/>,
		);
		expect(view.getByText("Base case")).toBeTruthy();
		expect(view.queryByText("65%")).toBeNull();
		expect(view.queryByText(/90% required/)).toBeNull();
		const dialog = openInspector(view);
		expect(dialog.getByText("Self-sustaining · Feb 2036")).toBeTruthy();
		expect(dialog.getByText("90% required · 400 scenarios")).toBeTruthy();
		expect(dialog.queryByRole("region", { name: "Base case" })).toBeNull();
	});

	it("keeps the inspector open across a recalculation and only closes it explicitly", () => {
		const view = render(
			<FinancialIndependenceCard item={independenceItem()} />,
		);
		const dialog = openInspector(view);
		expect(dialog.getByText("Funding as of Feb 2036")).toBeTruthy();
		// A recalculation arrives as a new analysis identity for the same
		// evaluation: the open inspector follows it instead of resetting.
		view.rerender(<FinancialIndependenceCard item={independenceItem()} />);
		const recalculated = within(
			view.getByRole("dialog", { name: "Financial independence" }),
		);
		expect(recalculated.getByText("Funding as of Feb 2036")).toBeTruthy();
		// Explicit close still owns dismissal.
		fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
		expect(view.queryByRole("dialog")).toBeNull();
	});
});
