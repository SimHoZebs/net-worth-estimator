import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BalanceDisplayData } from "./balanceDisplay.ts";
import { AccountBalances } from "./AccountBalances.tsx";

const data = (
	overrides: Partial<BalanceDisplayData> = {},
): BalanceDisplayData => ({
	entries: [
		{ label: "First figure", value: 798.01, emphasized: false },
		{ label: "Second figure", value: 1244.43, emphasized: true },
	],
	synced: "2026-01-31",
	...overrides,
});

const figure = (label: string) =>
	screen.getByText(label).nextElementSibling as HTMLElement;

describe("account balances", () => {
	it("renders exactly the entries the caller supplies", () => {
		render(<AccountBalances data={data()} />);
		expect(screen.getByText("First figure")).toBeTruthy();
		expect(screen.getByText("Second figure")).toBeTruthy();
		expect(figure("First figure").textContent).toBe("$798");
		expect(figure("Second figure").textContent).toBe("$1,244");
	});

	it("renders only a single supplied entry", () => {
		render(
			<AccountBalances
				data={data({
					entries: [{ label: "Only figure", value: 798.01, emphasized: true }],
				})}
			/>,
		);
		expect(screen.queryByText("Second figure")).toBeNull();
		expect(figure("Only figure").textContent).toBe("$798");
	});

	it("renders a caller-supplied zero as $0", () => {
		render(
			<AccountBalances
				data={data({
					entries: [{ label: "Zero figure", value: 0, emphasized: true }],
				})}
			/>,
		);
		expect(figure("Zero figure").textContent).toBe("$0");
		expect(screen.queryByText("Unavailable")).toBeNull();
	});

	it("emphasizes only the entries the caller marks emphasized", () => {
		render(<AccountBalances data={data()} />);
		expect(figure("Second figure").className).toContain(
			"text-lg font-semibold",
		);
		expect(figure("First figure").className).not.toContain("text-lg");
	});

	it("honors a different emphasis choice without deciding itself", () => {
		render(
			<AccountBalances
				data={data({
					entries: [
						{ label: "First figure", value: 798.01, emphasized: true },
						{ label: "Second figure", value: 1244.43, emphasized: false },
					],
				})}
			/>,
		);
		expect(figure("First figure").className).toContain("text-lg font-semibold");
		expect(figure("Second figure").className).not.toContain("text-lg");
	});

	it("renders an emphasized figure at the table's plain weight when asked", () => {
		render(<AccountBalances data={data()} emphasis="plain" />);
		expect(figure("Second figure").className).toContain(
			"text-sm font-normal tabular-nums text-foreground",
		);
		expect(figure("Second figure").className).not.toContain("text-lg");
		expect(figure("Second figure").className).not.toContain("font-semibold");
		expect(figure("First figure").className).not.toContain("text-lg");
	});

	it("omits the sync line when the caller supplies no sync date", () => {
		render(<AccountBalances data={data({ synced: null })} />);
		expect(screen.queryByText(/Last synced/)).toBeNull();
		expect(screen.queryByText("Jan 31, 2026")).toBeNull();
	});

	it("renders the caller's sync date inside a time element", () => {
		render(<AccountBalances data={data()} />);
		expect(screen.getByText(/Last synced/).textContent).toBe(
			"Last synced Jan 31, 2026",
		);
		const time = screen.getByText("Jan 31, 2026");
		expect(time.tagName).toBe("TIME");
		expect(time.getAttribute("datetime")).toBe("2026-01-31");
	});
});
