import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import { renderRouterSubject } from "../mocks/testRouter.tsx";
import {
	setServerModelFixture,
	setServerStatusFixture,
} from "../mocks/workspace.ts";
import { Outlook } from "./Outlook.tsx";

const blankData = {
	...financialModelFixture,
	accounts: [],
	transactions: [],
	evaluations: [],
};

beforeEach(() => {
	acceptTestResource();
	setServerModelFixture(blankData);
	setServerStatusFixture({
		readOnly: false,
		hasModel: true,
		syncConfigured: false,
		syncQuotaUsed: 0,
		syncQuotaLimit: 0,
	});
});

afterEach(() => {
	cleanup();
});

it("opens the first-account editor from an active blank workspace", async () => {
	const view = await renderRouterSubject(<Outlook />, "/outlook");
	expect(
		screen.getByRole("heading", { name: "Your workspace is ready" }),
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Add your first account" }),
	);
	await waitFor(() =>
		expect(view.router.state.location.search).toMatchObject({
			editor: "account",
			id: "new",
		}),
	);
});

it("honors the server write restriction on a blank workspace", async () => {
	setServerStatusFixture({
		readOnly: true,
		hasModel: true,
		syncConfigured: false,
		syncQuotaUsed: 0,
		syncQuotaLimit: 0,
	});
	await renderRouterSubject(<Outlook />, "/outlook");
	expect(
		screen.queryByRole("button", { name: "Add your first account" }),
	).toBeNull();
});

it("does not gate the blank workspace on a model-level flag alone", async () => {
	setServerModelFixture({ ...blankData, readOnly: true });
	await renderRouterSubject(<Outlook />, "/outlook");
	expect(
		screen.getByRole("button", { name: "Add your first account" }),
	).toBeTruthy();
});
