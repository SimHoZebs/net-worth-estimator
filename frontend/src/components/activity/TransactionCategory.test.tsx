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
			call.method === "PATCH" &&
			call.url.endsWith("/v1/postings/charge/category"),
	);
}

it("shows the category source and saves a user choice", async () => {
	const user = userEvent.setup();
	const server = stubTestServer();
	render(
		<TransactionCategory
			postingId="charge"
			category="FOOD_AND_DRINK"
			source="bank"
		/>,
	);
	expect(screen.getByText(/From your bank/)).toBeTruthy();
	await user.selectOptions(screen.getByLabelText("Category"), "MEDICAL");
	await waitFor(() => expect(categoryCalls(server)).toHaveLength(1));
	expect(categoryCalls(server)[0]?.body).toEqual({ category: "MEDICAL" });
});

it("resets a user override to automatic", async () => {
	const user = userEvent.setup();
	const server = stubTestServer();
	render(
		<TransactionCategory postingId="charge" category="MEDICAL" source="user" />,
	);
	expect(screen.getByText(/Set by you/)).toBeTruthy();
	await user.click(
		screen.getByRole("button", { name: "Use automatic category" }),
	);
	await waitFor(() => expect(categoryCalls(server)).toHaveLength(1));
	expect(categoryCalls(server)[0]?.body).toEqual({ category: null });
});

it("shows an unknown server key instead of a blank select", () => {
	render(
		<TransactionCategory
			postingId="charge"
			category="FUTURE_CATEGORY"
			source="bank"
		/>,
	);
	const select = screen.getByLabelText("Category") as HTMLSelectElement;
	expect(select.value).toBe("FUTURE_CATEGORY");
	expect(select.selectedOptions[0]?.textContent).toBe("FUTURE_CATEGORY");
});

it("stays enabled until app read-only is set", () => {
	const { rerender } = render(
		<TransactionCategory postingId="charge" category={null} source={null} />,
	);
	expect(
		(screen.getByLabelText("Category") as HTMLSelectElement).disabled,
	).toBe(false);
	expect(screen.getByText(/No category yet/)).toBeTruthy();
	rerender(
		<TransactionCategory
			postingId="charge"
			category={null}
			source={null}
			readOnly
		/>,
	);
	expect(
		(screen.getByLabelText("Category") as HTMLSelectElement).disabled,
	).toBe(true);
});
