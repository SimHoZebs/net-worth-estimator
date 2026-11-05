import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptTestResource } from "../../mocks/resource.ts";
import { resetServerQueryCache } from "../../state/serverQuery.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import { TransactionCategory } from "./TransactionCategory.tsx";

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
});

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

function categoryCalls(server: ReturnType<typeof stubTestServer>) {
	return server.calls.filter(
		(call) =>
			call.method === "POST" &&
			call.url.endsWith("/v1/transactions/charge/categorize"),
	);
}

function trigger() {
	return screen.getByRole("button", { name: /Category/ });
}

it("keeps the picker closed until the row is pressed", async () => {
	const user = userEvent.setup();
	stubTestServer();
	render(
		<TransactionCategory
			postingId="charge"
			category="FOOD_AND_DRINK"
			source="bank"
		/>,
	);
	expect(screen.queryByRole("listbox", { name: "Category" })).toBeNull();
	await user.click(trigger());
	expect(screen.getByRole("listbox", { name: "Category" })).toBeTruthy();
});

it("renders one row and saves a category chosen from the icon list", async () => {
	const user = userEvent.setup();
	const server = stubTestServer();
	render(
		<TransactionCategory
			postingId="charge"
			category="FOOD_AND_DRINK"
			source="bank"
		/>,
	);
	expect(trigger().textContent).toContain("Food & drink");
	expect(screen.getByText("From your bank")).toBeTruthy();
	await user.click(trigger());
	expect(screen.getByRole("listbox", { name: "Category" })).toBeTruthy();
	expect(
		screen
			.getByRole("option", { name: "Food & drink" })
			.getAttribute("aria-selected"),
	).toBe("true");
	await user.click(screen.getByRole("option", { name: "Medical" }));
	await waitFor(() => expect(categoryCalls(server)).toHaveLength(1));
	expect(categoryCalls(server)[0]?.body).toEqual({ category: "MEDICAL" });
});

it("resets a user override to automatic", async () => {
	const user = userEvent.setup();
	const server = stubTestServer();
	render(
		<TransactionCategory postingId="charge" category="MEDICAL" source="user" />,
	);
	expect(screen.getByText("Set by you")).toBeTruthy();
	await user.click(trigger());
	await user.click(screen.getByRole("button", { name: "Use automatic" }));
	await waitFor(() => expect(categoryCalls(server)).toHaveLength(1));
	expect(categoryCalls(server)[0]?.body).toEqual({ category: null });
});

it("shows an unknown server key in the row instead of a blank value", async () => {
	const user = userEvent.setup();
	stubTestServer();
	render(
		<TransactionCategory
			postingId="charge"
			category="FUTURE_CATEGORY"
			source="bank"
		/>,
	);
	expect(trigger().textContent).toContain("FUTURE_CATEGORY");
	await user.click(trigger());
	expect(screen.getByRole("option", { name: "Medical" })).toBeTruthy();
});

it("stays enabled until app read-only is set", () => {
	const { rerender } = render(
		<TransactionCategory postingId="charge" category={null} source={null} />,
	);
	expect((trigger() as HTMLButtonElement).disabled).toBe(false);
	expect(trigger().textContent).toContain("Not categorized");
	rerender(
		<TransactionCategory
			postingId="charge"
			category={null}
			source={null}
			readOnly
		/>,
	);
	expect((trigger() as HTMLButtonElement).disabled).toBe(true);
});
