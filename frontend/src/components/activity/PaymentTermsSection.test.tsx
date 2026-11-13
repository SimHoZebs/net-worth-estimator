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
import { acceptTestResource } from "../../mocks/resource.ts";
import { fixtureModel } from "../../mocks/model.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../../state/serverQuery.ts";
import { getPaymentTermsForAccount } from "../../state/workspaceResources.ts";
import { PaymentTermsSection } from "./PaymentTermsSection.tsx";

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});
beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
	<QueryClientProvider client={serverQueryClient()}>
		{children}
	</QueryClientProvider>
);

const savedTerms = {
	accountId: "mortgage",
	minimumFixed: 25,
	minimumPercent: 0.02,
	dueDay: 15,
	statementDay: 20,
};

function stubTermsServer(paymentTerms: (typeof savedTerms)[] | [] = []) {
	return stubTestServer(undefined, {
		...fixtureModel(),
		paymentTerms,
	});
}

async function fillTerms(
	values: {
		minimum?: string;
		percent?: string;
		due?: string;
		statement?: string;
	},
	user: ReturnType<typeof userEvent.setup>,
) {
	if (values.minimum !== undefined) {
		await user.clear(screen.getByLabelText("Minimum payment in USD"));
		if (values.minimum)
			await user.type(
				screen.getByLabelText("Minimum payment in USD"),
				values.minimum,
			);
	}
	if (values.percent !== undefined) {
		await user.clear(screen.getByLabelText("Minimum percent of the balance"));
		if (values.percent)
			await user.type(
				screen.getByLabelText("Minimum percent of the balance"),
				values.percent,
			);
	}
	if (values.due !== undefined) {
		await user.clear(screen.getByLabelText("Due day of the month"));
		if (values.due)
			await user.type(
				screen.getByLabelText("Due day of the month"),
				values.due,
			);
	}
	if (values.statement !== undefined) {
		await user.clear(
			screen.getByLabelText("Statement day of the month, optional"),
		);
		if (values.statement)
			await user.type(
				screen.getByLabelText("Statement day of the month, optional"),
				values.statement,
			);
	}
}

it("prefills saved terms and saves edits through the payment-terms endpoint", async () => {
	const server = stubTermsServer([savedTerms]);
	const user = userEvent.setup();
	render(<PaymentTermsSection accountId="mortgage" readOnly={false} />, {
		wrapper,
	});
	expect(await screen.findByLabelText("Minimum payment in USD")).toBeTruthy();
	expect(
		(screen.getByLabelText("Minimum payment in USD") as HTMLInputElement).value,
	).toBe("25");
	expect(
		(
			screen.getByLabelText(
				"Minimum percent of the balance",
			) as HTMLInputElement
		).value,
	).toBe("2");
	expect(
		(screen.getByLabelText("Due day of the month") as HTMLInputElement).value,
	).toBe("15");
	expect(
		(
			screen.getByLabelText(
				"Statement day of the month, optional",
			) as HTMLInputElement
		).value,
	).toBe("20");
	await fillTerms({ minimum: "30" }, user);
	await user.click(screen.getByRole("button", { name: "Save payment terms" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) => call.method === "POST" && call.url === "/v1/payment-terms",
			),
		).toBe(true),
	);
	const body = server.calls.find(
		(call) => call.method === "POST" && call.url === "/v1/payment-terms",
	)!.body as Record<string, unknown>;
	expect(body).toEqual({
		accountId: "mortgage",
		minimumFixed: 30,
		minimumPercent: 0.02,
		dueDay: 15,
		statementDay: 20,
	});
	await waitFor(() =>
		expect(getPaymentTermsForAccount("mortgage")).toMatchObject({
			minimumFixed: 30,
		}),
	);
	expect(
		(
			screen.getByRole("button", {
				name: "Save payment terms",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

it("omits empty optional fields from the save body", async () => {
	const server = stubTermsServer();
	const user = userEvent.setup();
	render(<PaymentTermsSection accountId="mortgage" readOnly={false} />, {
		wrapper,
	});
	expect(await screen.findByLabelText("Minimum payment in USD")).toBeTruthy();
	await fillTerms({ minimum: "25", due: "15" }, user);
	await user.click(screen.getByRole("button", { name: "Save payment terms" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) => call.method === "POST" && call.url === "/v1/payment-terms",
			),
		).toBe(true),
	);
	const body = server.calls.find(
		(call) => call.method === "POST" && call.url === "/v1/payment-terms",
	)!.body as Record<string, unknown>;
	expect(body).toEqual({
		accountId: "mortgage",
		minimumFixed: 25,
		dueDay: 15,
	});
});

it("rejects missing minimums and out-of-range days before saving", async () => {
	const server = stubTermsServer();
	const user = userEvent.setup();
	const view = render(
		<PaymentTermsSection accountId="mortgage" readOnly={false} />,
		{
			wrapper,
		},
	);
	expect(await screen.findByLabelText("Minimum payment in USD")).toBeTruthy();
	await fillTerms({ due: "15" }, user);
	await user.click(screen.getByRole("button", { name: "Save payment terms" }));
	expect(
		await screen.findByText("Enter a minimum payment in USD."),
	).toBeTruthy();
	// Out-of-range numbers trip native validation on click, so submit the
	// form directly to exercise the manual messages, as the account
	// settings test does.
	const form = () => view.container.querySelector("form")!;
	await fillTerms({ minimum: "25", due: "29" }, user);
	fireEvent.submit(form());
	expect(
		await screen.findByText("Enter a due day between 1 and 28."),
	).toBeTruthy();
	await fillTerms({ due: "15", percent: "101" }, user);
	fireEvent.submit(form());
	expect(
		await screen.findByText(
			"Enter the minimum percent as a number between 0 and 100.",
		),
	).toBeTruthy();
	await fillTerms({ percent: "", statement: "0" }, user);
	fireEvent.submit(form());
	expect(
		await screen.findByText(
			"Enter a statement day between 1 and 28, or leave it empty.",
		),
	).toBeTruthy();
	expect(
		server.calls.some(
			(call) => call.method === "POST" && call.url === "/v1/payment-terms",
		),
	).toBe(false);
});

it("removes terms through Remove and through clearing the minimum", async () => {
	const server = stubTermsServer([savedTerms]);
	const user = userEvent.setup();
	render(<PaymentTermsSection accountId="mortgage" readOnly={false} />, {
		wrapper,
	});
	expect(await screen.findByLabelText("Minimum payment in USD")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Remove" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "DELETE" && call.url === "/v1/payment-terms/mortgage",
			),
		).toBe(true),
	);
	await waitFor(() => expect(getPaymentTermsForAccount("mortgage")).toBeNull());
	expect(
		(screen.getByLabelText("Minimum payment in USD") as HTMLInputElement).value,
	).toBe("");
	// Saving again after re-entering values recreates the row; clearing the
	// minimum then removes it through the save action.
	await fillTerms({ minimum: "25", due: "15" }, user);
	await user.click(screen.getByRole("button", { name: "Save payment terms" }));
	await waitFor(() =>
		expect(getPaymentTermsForAccount("mortgage")).toMatchObject({
			minimumFixed: 25,
		}),
	);
	await user.clear(screen.getByLabelText("Minimum payment in USD"));
	expect(
		(
			screen.getByRole("button", {
				name: "Remove payment terms",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
	await user.click(
		screen.getByRole("button", { name: "Remove payment terms" }),
	);
	await waitFor(() =>
		expect(
			server.calls.filter(
				(call) =>
					call.method === "DELETE" && call.url === "/v1/payment-terms/mortgage",
			),
		).toHaveLength(2),
	);
	expect(getPaymentTermsForAccount("mortgage")).toBeNull();
});

it("surfaces server failures inline and keeps the draft", async () => {
	const server = stubTermsServer();
	server.writeOnce(
		(method, path) => method === "POST" && path === "/v1/payment-terms",
		{
			value: {
				accountId: "mortgage",
				minimumFixed: 25,
				dueDay: 99,
			},
			issues: [
				{
					severity: "error",
					code: "terms.dueDay.invalid",
					message:
						"Payment terms for 'mortgage' need a due day between 1 and 28.",
					path: ["paymentTerms", 0, "dueDay"],
				},
			],
			saved: false,
			revision: "test",
		},
	);
	const user = userEvent.setup();
	render(<PaymentTermsSection accountId="mortgage" readOnly={false} />, {
		wrapper,
	});
	expect(await screen.findByLabelText("Minimum payment in USD")).toBeTruthy();
	await fillTerms({ minimum: "25", due: "15" }, user);
	await user.click(screen.getByRole("button", { name: "Save payment terms" }));
	expect(
		await screen.findByText(
			"Payment terms for 'mortgage' need a due day between 1 and 28.",
		),
	).toBeTruthy();
	expect(
		(screen.getByLabelText("Minimum payment in USD") as HTMLInputElement).value,
	).toBe("25");
	expect(getPaymentTermsForAccount("mortgage")).toBeNull();
});

it("locks the form when read-only", async () => {
	stubTermsServer([savedTerms]);
	render(<PaymentTermsSection accountId="mortgage" readOnly />, {
		wrapper,
	});
	expect(await screen.findByLabelText("Minimum payment in USD")).toBeTruthy();
	expect(
		(screen.getByLabelText("Minimum payment in USD") as HTMLInputElement)
			.readOnly,
	).toBe(true);
	expect(
		screen.queryByRole("button", { name: "Save payment terms" }),
	).toBeNull();
	expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
});
