import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { acceptTestResource } from "../test/resource.ts";
import { ok } from "../test/fetch.ts";
import {
	hydrateFinancialPreferences,
	resolveEffectiveIds,
	useSafeSpendingSettings,
} from "./useSafeSpendingSettings.ts";

function stubSafeSpending() {
	const seen: { url: string; init?: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			seen.push({ url: String(url), init });
			const settings =
				(init?.method ?? "GET") === "GET"
					? null
					: JSON.parse(String(init?.body ?? "{}"));
			return ok({ settings });
		}),
	);
	return seen;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("updates a controlled checkbox synchronously from the optimistic query value", async () => {
	stubSafeSpending();
	const scope = acceptTestResource()!;
	await hydrateFinancialPreferences(scope);
	function Control() {
		const settings = useSafeSpendingSettings();
		return createElement("input", {
			type: "checkbox",
			"aria-label": "Salary",
			checked: settings.incomeRuleIds.includes("salary"),
			onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
				settings.updateSettings({
					incomeRuleIds: event.target.checked ? ["salary"] : [],
				}),
		});
	}
	render(createElement(Control));
	const checkbox = screen.getByRole("checkbox", {
		name: "Salary",
	}) as HTMLInputElement;
	fireEvent.click(checkbox);
	expect(checkbox.checked).toBe(true);
	fireEvent.click(checkbox);
	expect(checkbox.checked).toBe(false);
});

describe("resolveEffectiveIds", () => {
	it("returns every known id when nothing is stored", () => {
		expect(resolveEffectiveIds(null, ["a_card", "loan"])).toEqual([
			"a_card",
			"loan",
		]);
	});

	it("keeps stored non-card debt instead of reverting to the card set", () => {
		expect(
			resolveEffectiveIds(["loan"], ["a_card", "loan"], ["a_card"]),
		).toEqual(["loan"]);
	});

	it("drops unknown ids and falls back when nothing known remains", () => {
		expect(
			resolveEffectiveIds(["gone"], ["a_card", "loan"], ["a_card"]),
		).toEqual(["a_card"]);
	});

	it("falls back to the override set instead of every known id", () => {
		expect(
			resolveEffectiveIds(null, ["checking", "savings"], ["checking"]),
		).toEqual(["checking"]);
	});
});
