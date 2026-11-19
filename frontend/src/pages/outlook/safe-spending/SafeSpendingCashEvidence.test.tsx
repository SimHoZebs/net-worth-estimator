import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SafeSpendingCashEvidence } from "./SafeSpendingCashEvidence.tsx";
import type { AllowanceEvidence } from "./safeSpendingDetailModel.ts";

function evidence(
	overrides: Partial<AllowanceEvidence> = {},
): AllowanceEvidence {
	return {
		status: "available",
		message: null,
		checkingAvailable: 1244.43,
		cashAsOf: "2026-11-15",
		baselines: [
			{
				accountId: "checking",
				accountName: "Synthetic checking",
				basis: "available",
				status: "available",
				amount: 1244.43,
			},
		],
		...overrides,
	};
}

const render = (data?: AllowanceEvidence, pending = false, error = false) =>
	renderToStaticMarkup(
		<SafeSpendingCashEvidence
			evidence={data}
			pending={pending}
			error={error}
			onRetry={() => {}}
		/>,
	);

describe("safe spending cash evidence", () => {
	it("renders the server's cash figure, its date and each baseline", () => {
		const html = render(evidence());
		expect(html).toContain('data-testid="cash-on-hand">$1,244.43');
		expect(html).toContain("Cash as of 2026-11-15");
		expect(html).toContain("Synthetic checking · observed available");
	});

	it("shows the uncertainty state without exposing internal reason codes", () => {
		const html = render(
			evidence({
				status: "uncertain",
				message: "Allowance uncertain",
				checkingAvailable: null,
			}),
		);
		expect(html).toContain('data-testid="cash-on-hand">—');
		expect(html).toContain("Allowance uncertain");
		expect(html).not.toContain("posted-hold-coverage-unknown");
	});

	it("shows the missing state with a known baseline still visible", () => {
		const html = render(
			evidence({
				status: "missing",
				message: "Allowance unavailable",
				checkingAvailable: null,
				baselines: [
					{
						accountId: "checking",
						accountName: "Synthetic checking",
						basis: "posted",
						status: "missing",
						amount: 500,
					},
				],
			}),
		);
		expect(html).toContain("Allowance unavailable");
		expect(html).toContain("Synthetic checking · posted balance");
		expect(html).toContain("$500.00");
	});

	it("renders a pending slot and a retry when the read fails", () => {
		expect(render(undefined, true)).toContain("Loading cash evidence…");
		const failed = render(undefined, false, true);
		expect(failed).toContain("Cash evidence could not be loaded.");
		expect(failed).toContain("Retry cash evidence");
	});

	it("marks a negative cash figure as a shortfall", () => {
		expect(render(evidence({ checkingAvailable: -20 }))).toContain(
			"text-danger-text",
		);
		expect(render(evidence({ checkingAvailable: 0 }))).not.toContain(
			"text-danger-text",
		);
	});
});
