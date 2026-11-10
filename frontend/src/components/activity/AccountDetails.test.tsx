import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { fixtureModel } from "../../mocks/model.ts";
import { acceptTestResource } from "../../mocks/resource.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import { setServerModelFixture } from "../../mocks/workspace.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../../state/serverQuery.ts";
import type { Account } from "../../domain/model.ts";
import { NO_CEILING_SENTINEL } from "../../api/contracts.ts";
import { AccountDetails } from "./AccountDetails.tsx";
import { useAccountEdit } from "./useAccountEdit.ts";
import { DetailEditActions } from "./DetailEditActions.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";

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
function Settings({ account = home }: { account?: Account }) {
	const edit = useAccountEdit(account, account.readOnly, []);
	return (
		<>
			<form id={edit.formId} onSubmit={(event) => void edit.submit(event)} />
			<AccountDetails
				account={account}
				edit={edit}
				readOnly={account.readOnly}
			/>
			{edit.activeField && (
				<DetailEditActions
					formId={edit.formId}
					onDiscard={edit.reset}
					disabled={edit.saveBlocked}
				/>
			)}
			<ErrorNotice message={edit.error} />
		</>
	);
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
	<QueryClientProvider client={serverQueryClient()}>
		{children}
	</QueryClientProvider>
);

it("uses property controls without duplicate header fields or a permanent save footer", async () => {
	const server = stubTestServer();
	const user = userEvent.setup();
	render(<Settings />, { wrapper });
	expect(screen.queryByLabelText("Account name")).toBeNull();
	expect(screen.queryByLabelText("Balance (USD)")).toBeNull();
	expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
	await user.clear(screen.getByLabelText("Protected balance in USD"));
	await user.type(screen.getByLabelText("Protected balance in USD"), "5000");
	await user.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(server.calls.some((call) => call.method === "PATCH")).toBe(true),
	);
	const body = server.calls.find((call) => call.method === "PATCH")!
		.body as Record<string, unknown>;
	expect(body.minBalance).toBe(5000);
	expect(body.balance).toBeUndefined();
	expect(body.observedAt).toBeUndefined();
	expect(body.color).toBe("#a16207");
});

it("discards settings through the same header action as transaction details", async () => {
	const user = userEvent.setup();
	render(<Settings />, { wrapper });
	await user.click(screen.getByLabelText("No ceiling"));
	expect(
		(screen.getByLabelText("Maximum balance in USD") as HTMLInputElement).value,
	).toBe("0");
	await user.type(screen.getByLabelText("Maximum balance in USD"), "100000");
	await user.click(screen.getByRole("button", { name: "Discard changes" }));
	expect(screen.queryByLabelText("Maximum balance in USD")).toBeNull();
	expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("preserves raw limits when only inclusion changes", async () => {
	const model = fixtureModel(financialModelFixture);
	const raw = model.accounts.find((row) => row.id === "home")!;
	raw.minBalance = -2500;
	raw.maxBalance = NO_CEILING_SENTINEL;
	const server = stubTestServer(undefined, model);
	setServerModelFixture(financialModelFixture, { model });
	const user = userEvent.setup();
	render(<Settings />, { wrapper });
	await user.click(
		screen.getByLabelText("Include in net worth and projections"),
	);
	await user.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(server.calls.some((call) => call.method === "PATCH")).toBe(true),
	);
	const body = server.calls.find((call) => call.method === "PATCH")!
		.body as Record<string, unknown>;
	expect(body.minBalance).toBe(-2500);
	expect(body.maxBalance).toBe(NO_CEILING_SENTINEL);
	expect(body.enabled).toBe(false);
});

it("keeps invalid input and rejects same-field conflicts", async () => {
	const server = stubTestServer();
	const user = userEvent.setup();
	const view = render(<Settings />, { wrapper });
	await user.clear(screen.getByLabelText("Protected balance in USD"));
	fireEvent.submit(view.container.querySelector("form")!);
	expect(
		await screen.findByText("Enter a protected balance in USD."),
	).toBeTruthy();
	await user.type(screen.getByLabelText("Protected balance in USD"), "500");
	view.rerender(<Settings account={{ ...home, minBalance: 100 }} />);
	await user.click(screen.getByRole("button", { name: "Save changes" }));
	expect(
		await screen.findByText(/This account changed during your edit/),
	).toBeTruthy();
	expect(server.calls.some((call) => call.method === "PATCH")).toBe(false);
	await user.click(screen.getByRole("button", { name: "Discard changes" }));
	expect(
		(screen.getByLabelText("Protected balance in USD") as HTMLInputElement)
			.value,
	).toBe("100");
});

it("keeps read-only property controls locked", () => {
	render(<Settings account={{ ...home, readOnly: true }} />, { wrapper });
	expect(
		(screen.getByLabelText("Protected balance in USD") as HTMLInputElement)
			.readOnly,
	).toBe(true);
	expect(
		(
			screen.getByLabelText(
				"Include in net worth and projections",
			) as HTMLInputElement
		).disabled,
	).toBe(true);
	expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("offers every account type on the read-only kind selector", async () => {
	const user = userEvent.setup();
	render(<Settings account={{ ...home, readOnly: true }} />, { wrapper });
	const select = screen.getByLabelText("Account type") as HTMLSelectElement;
	expect(select.disabled).toBe(false);
	expect(Array.from(select.options).map((option) => option.value)).toEqual([
		"cash",
		"investment",
		"property",
		"debt",
	]);
	await user.selectOptions(select, "debt");
	expect(
		await screen.findByRole("button", { name: "Save changes" }),
	).toBeTruthy();
});

it("saves a synced account kind with its current bounds verbatim", async () => {
	const server = stubTestServer();
	setServerModelFixture();
	const user = userEvent.setup();
	const mortgage = financialModelFixture.accounts.find(
		(account) => account.id === "mortgage",
	)!;
	render(<Settings account={{ ...mortgage, kind: "cash", readOnly: true }} />, {
		wrapper,
	});
	await user.selectOptions(screen.getByLabelText("Account type"), "debt");
	await user.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(server.calls.some((call) => call.method === "PATCH")).toBe(true),
	);
	const body = server.calls.find((call) => call.method === "PATCH")!
		.body as Record<string, unknown>;
	expect(body.kind).toBe("debt");
	expect(body.name).toBe(mortgage.name);
	expect(body.minBalance).toBe(0);
	expect(body.maxBalance).toBe(0);
	expect(body.balance).toBeUndefined();
	expect(body.observedAt).toBeUndefined();
});

it("refuses a synced kind that contradicts the bank balance", async () => {
	const server = stubTestServer();
	setServerModelFixture();
	const user = userEvent.setup();
	render(<Settings account={{ ...home, readOnly: true }} />, { wrapper });
	await user.selectOptions(screen.getByLabelText("Account type"), "debt");
	await user.click(screen.getByRole("button", { name: "Save changes" }));
	expect(
		await screen.findByText(
			"A debt account cannot hold a positive bank balance.",
		),
	).toBeTruthy();
	expect(server.calls.some((call) => call.method === "PATCH")).toBe(false);
});

it("fails closed when the current bounds cannot be read", async () => {
	const server = stubTestServer();
	setServerModelFixture();
	const user = userEvent.setup();
	const mortgage = financialModelFixture.accounts.find(
		(account) => account.id === "mortgage",
	)!;
	render(<Settings account={{ ...mortgage, kind: "cash", readOnly: true }} />, {
		wrapper,
	});
	await user.selectOptions(screen.getByLabelText("Account type"), "debt");
	// The synced-kind write carries the saved bounds verbatim, so an
	// unreadable bounds cache must block the save instead of clearing
	// real bounds to open.
	resetServerQueryCache();
	await user.click(screen.getByRole("button", { name: "Save changes" }));
	expect(await screen.findByText(/could not be saved/i)).toBeTruthy();
	expect(server.calls.some((call) => call.method === "PATCH")).toBe(false);
});

it("shows the linked bank identity as definition rows for synced accounts", () => {
	render(
		<Settings
			account={{
				...home,
				name: "Checking 8472",
				institution: "Chase",
				syncedName: "Chase Checking 8472",
				currency: "USD",
				readOnly: true,
			}}
		/>,
		{ wrapper },
	);
	expect(screen.getByText("Bank").tagName).toBe("DT");
	expect(screen.getByText("Chase").tagName).toBe("DD");
	expect(screen.getByText("Synced as")).toBeTruthy();
	expect(screen.getByText("Chase Checking 8472")).toBeTruthy();
	expect(screen.getByText("USD")).toBeTruthy();
	expect(screen.getByText("Last synced")).toBeTruthy();
	expect(screen.queryByText("Source")).toBeNull();
	expect(screen.queryByText("Bank account")).toBeNull();
	expect(screen.queryByText("Balance & limits")).toBeNull();
});
