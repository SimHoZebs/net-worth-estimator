import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { NO_CEILING_SENTINEL } from "../../api/contracts.ts";
import { fixtureModel } from "../../mocks/model.ts";
import { acceptTestResource } from "../../mocks/resource.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import { setServerModelFixture } from "../../mocks/workspace.ts";
import { resetServerQueryCache } from "../../state/serverQuery.ts";
import { AccountDetails } from "./AccountDetails.tsx";

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
});

const home = financialModelFixture.accounts.find(
	(account) => account.id === "home",
)!;

function input(name: string): HTMLInputElement {
	const element = screen.getByLabelText(name);
	if (!(element instanceof HTMLInputElement))
		throw new Error(`Expected an input labelled "${name}"`);
	return element;
}

it("refreshes untouched fields without creating a local edit", () => {
	const props = { account: home, endingBalance: 480000 };
	const view = render(<AccountDetails {...props} />);
	view.rerender(
		<AccountDetails {...props} account={{ ...home, name: "Current home" }} />,
	);
	expect(input("Account name").value).toBe("Current home");
	expect(
		(
			screen.getByRole("button", {
				name: "Save changes",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

it("preserves edits across unrelated refreshes and rejects same-field conflicts", async () => {
	const server = stubTestServer();
	const props = { account: home, endingBalance: 480000 };
	const view = render(<AccountDetails {...props} />);
	fireEvent.change(input("Account name"), { target: { value: "My home" } });
	view.rerender(
		<AccountDetails
			{...props}
			account={{ ...home, balance: home.balance + 100 }}
		/>,
	);
	expect(input("Account name").value).toBe("My home");
	view.rerender(
		<AccountDetails {...props} account={{ ...home, name: "Another name" }} />,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(
			screen.getByText(
				"This account changed during your edit. Discard your edits before applying new changes.",
			),
		).toBeTruthy(),
	);
	expect(
		server.calls.some(
			(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
		),
	).toBe(false);
	fireEvent.click(
		screen.getByRole("button", {
			name: "Discard edits and use current values",
		}),
	);
	expect(input("Account name").value).toBe("Another name");
});

it("edits inline with source display-only and a grouped balance range", async () => {
	const server = stubTestServer();
	render(<AccountDetails account={home} endingBalance={480000} />);
	// No second modal: there is no edit button, fields are live inputs.
	expect(screen.queryByRole("button", { name: "Edit account" })).toBeNull();
	expect(input("Account name").value).toBe("Home value");
	// Source is provenance text, never an editable field.
	expect(screen.getByText("Source")).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: "Source" })).toBeNull();
	expect(screen.getByText("Example home estimate")).toBeTruthy();
	// Protected and ceiling share one range group with a visual track.
	expect(
		screen.getByRole("group", { name: "Balance limits (USD)" }),
	).toBeTruthy();
	expect(input("Protected balance in USD").value).toBe("0");
	expect(input("Maximum balance in USD").disabled).toBe(true);
	expect(input("No ceiling").checked).toBe(true);
	const apply = screen.getByRole("button", {
		name: "Save changes",
	}) as HTMLButtonElement;
	expect(apply.disabled).toBe(true);
	fireEvent.change(input("Protected balance in USD"), {
		target: { value: "5000" },
	});
	expect(apply.disabled).toBe(false);
	fireEvent.click(apply);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
			),
		).toBe(true),
	);
	const body = server.calls.find(
		(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
	)?.body as Record<string, unknown>;
	expect(body.minBalance).toBe(5000);
	// Balance untouched: only authored balance fields move with the save.
	expect(body.balance).toBeUndefined();
	// System-owned color survives the edit untouched.
	expect(body.color).toBe("#a16207");
});

it("unchecking the ceiling enables the maximum input", async () => {
	const server = stubTestServer();
	render(<AccountDetails account={home} endingBalance={480000} />);
	fireEvent.click(input("No ceiling"));
	const ceiling = input("Maximum balance in USD");
	expect(ceiling.disabled).toBe(false);
	expect(ceiling.value).toBe("0");
	fireEvent.change(ceiling, { target: { value: "100000" } });
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
			),
		).toBe(true),
	);
	const body = server.calls.find(
		(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
	)?.body as Record<string, unknown>;
	expect(body.maxBalance).toBe(100000);
});

it("preserves raw null floors and sentinel ceilings on a name-only save", async () => {
	const model = fixtureModel(financialModelFixture);
	const raw = model.accounts.find((row) => row.id === "home")!;
	raw.minBalance = null;
	raw.maxBalance = NO_CEILING_SENTINEL;
	const server = stubTestServer(undefined, model);
	acceptTestResource();
	setServerModelFixture(financialModelFixture, { model });
	render(<AccountDetails account={home} endingBalance={480000} />);
	fireEvent.change(input("Account name"), {
		target: { value: "Home value revised" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
			),
		).toBe(true),
	);
	const body = server.calls.find(
		(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
	)?.body as Record<string, unknown>;
	expect(body.name).toBe("Home value revised");
	// Unedited bounds ride verbatim: a null floor stays omitted, and the
	// sentinel ceiling is preserved exactly instead of being rewritten as a
	// display null (which would clear a real stored value).
	expect(body).not.toHaveProperty("minBalance");
	expect(body.maxBalance).toBe(NO_CEILING_SENTINEL);
	// Balance untouched: no observation moves with the save.
	expect(body.balance).toBeUndefined();
});

it("keeps a raw negative floor verbatim on a name-only save", async () => {
	const model = fixtureModel(financialModelFixture);
	const raw = model.accounts.find((row) => row.id === "home")!;
	raw.minBalance = -2500;
	raw.maxBalance = null;
	const server = stubTestServer(undefined, model);
	acceptTestResource();
	setServerModelFixture(financialModelFixture, { model });
	render(<AccountDetails account={home} endingBalance={480000} />);
	fireEvent.change(input("Account name"), {
		target: { value: "Home value revised" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
			),
		).toBe(true),
	);
	const body = server.calls.find(
		(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
	)?.body as Record<string, unknown>;
	expect(body.minBalance).toBe(-2500);
	expect(body).not.toHaveProperty("maxBalance");
});

it("rejects blank and invalid numerics without saving", async () => {
	const server = stubTestServer();
	acceptTestResource();
	const { container } = render(
		<AccountDetails account={home} endingBalance={480000} />,
	);
	// fireEvent.submit bypasses native required validation, exercising the
	// form's own rejection the same way a programmatic submit would.
	const form = container.querySelector("form")!;
	fireEvent.change(input("Balance (USD)"), { target: { value: "" } });
	fireEvent.submit(form);
	await waitFor(() =>
		expect(screen.getByText("Enter a balance in USD.")).toBeTruthy(),
	);
	expect(
		server.calls.some(
			(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
		),
	).toBe(false);
	// Rejected values stay in the form for correction.
	expect(input("Balance (USD)").value).toBe("");
	fireEvent.change(input("Balance (USD)"), {
		target: { value: String(home.balance) },
	});
	fireEvent.change(input("Protected balance in USD"), {
		target: { value: "not-a-number" },
	});
	fireEvent.submit(form);
	await waitFor(() =>
		expect(screen.getByText("Enter a protected balance in USD.")).toBeTruthy(),
	);
	expect(
		server.calls.some(
			(call) => call.method === "PATCH" && call.url === "/v1/accounts/home",
		),
	).toBe(false);
	// Number inputs sanitize non-numeric text to empty; the rejected empty
	// value stays in the form for correction.
	expect(input("Protected balance in USD").value).toBe("");
});

it("locks every field for read-only source records", () => {
	const { container } = render(
		<AccountDetails
			account={{ ...home, readOnly: true }}
			endingBalance={480000}
		/>,
	);
	// jsdom does not cascade fieldset[disabled] to the disabled IDL, so
	// assert the attribute on the group itself: real browsers lock all
	// descendants behind it.
	expect(container.querySelector("fieldset[disabled]")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
	expect(screen.getByText(/refreshed copy/)).toBeTruthy();
});
