import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Account } from "../../domain/model.ts";
import { AccountDetails } from "./AccountDetails.tsx";
import { LoanDetails } from "./LoanDetails.tsx";
import type { AccountEdit } from "./useAccountEdit.ts";

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: "cash",
		name: "Cash",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 798.01,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Synced balance check",
		readOnly: true,
		observedAt: 1773133200,
		observedBalance: 798.01,
		availableBalance: null,
		displayBasis: "available",
		...overrides,
	};
}

function editStub(
	displayBasis: "available" | "posted" = "available",
): AccountEdit {
	return {
		draft: {
			name: "Cash",
			kind: "cash",
			enabled: true,
			displayBasis,
			minBalance: "0",
			maxBalance: "",
			noCeiling: true,
			minimumFixed: "",
			minimumPercent: "",
			dueDay: "",
			statementClosingDay: "19",
		},
		formId: "form",
		saving: false,
		update: () => {},
	} as unknown as AccountEdit;
}

function displayValue(html: string) {
	const trigger = html.match(
		/<button[^>]*aria-label="Display value"[^>]*>([\s\S]*?)<\/button>/,
	);
	if (!trigger) throw new Error("Missing display value selector");
	return {
		disabled: /\bdisabled=""/.test(trigger[0] ?? ""),
		label:
			/<span[^>]*data-slot="select-value"[^>]*>([^<]*)<\/span>/.exec(
				trigger[1] ?? "",
			)?.[1] ?? "",
	};
}

function renderDetails(kind: "account" | "loan") {
	const row = account({
		availableBalance: 1244.43,
		kind: kind === "loan" ? "debt" : "cash",
	});
	if (kind === "loan") {
		render(<LoanDetails account={row} readOnly={false} onEdit={() => {}} />);
		return;
	}
	render(<AccountDetails account={row} edit={editStub()} readOnly={false} />);
}

describe("details balance rows", () => {
	it.each(["account", "loan"] as const)(
		"renders every %s balance with uniform details-row styling",
		(kind) => {
			renderDetails(kind);
			for (const text of ["$798", "$1,244"]) {
				const value = screen.getByText(text);
				expect(value.className).toContain(
					"text-sm font-medium tabular-nums text-foreground",
				);
				expect(value.className).not.toContain("text-lg");
				expect(value.className).not.toContain("font-normal");
				expect(value.className).not.toContain("font-semibold");
				expect(value.className).not.toContain("text-muted-foreground");
			}
			const synced = screen.getByText("Jan 31, 2026");
			expect(synced.tagName).toBe("TIME");
			expect(synced.getAttribute("datetime")).toBe("2026-01-31");
		},
	);
});

describe("display value selector gating", () => {
	it("locks the details selector to the only figure and leaves the draft alone", () => {
		const edit = editStub();
		const html = renderToStaticMarkup(
			<AccountDetails account={account()} edit={edit} readOnly={false} />,
		);
		expect(html).not.toContain("Available balance");
		expect(html).not.toContain("Unavailable");
		expect(displayValue(html)).toEqual({ disabled: true, label: "Posted" });
		expect(edit.draft.displayBasis).toBe("available");
	});

	it("allows the details selector when both figures exist", () => {
		const html = renderToStaticMarkup(
			<AccountDetails
				account={account({ availableBalance: 1244.43 })}
				edit={editStub()}
				readOnly={false}
			/>,
		);
		expect(html).toContain("Available balance");
		expect(displayValue(html)).toEqual({ disabled: false, label: "Available" });
	});

	it("follows the details draft choice while both figures exist", () => {
		const html = renderToStaticMarkup(
			<AccountDetails
				account={account({ availableBalance: 1244.43 })}
				edit={editStub("posted")}
				readOnly={false}
			/>,
		);
		expect(displayValue(html)).toEqual({ disabled: false, label: "Posted" });
	});

	it("locks the grouped selector to the only figure", () => {
		const html = renderToStaticMarkup(
			<LoanDetails
				account={account({ kind: "debt" })}
				readOnly={false}
				onEdit={() => {}}
			/>,
		);
		expect(html).not.toContain("Available balance");
		expect(html).not.toContain("Unavailable");
		expect(displayValue(html)).toEqual({ disabled: true, label: "Posted" });
	});

	it("allows the grouped selector when both figures exist", () => {
		const html = renderToStaticMarkup(
			<LoanDetails
				account={account({ kind: "debt", availableBalance: 1244.43 })}
				readOnly={false}
				onEdit={() => {}}
			/>,
		);
		expect(html).toContain("Available balance");
		expect(displayValue(html)).toEqual({ disabled: false, label: "Available" });
	});
});
