import { expect, request, test, type APIRequestContext } from "./base.ts";
import { FIXTURE_API, readSavedServerModel } from "./fixture.ts";

const ACCOUNT_ID = "delete-history-account";

async function seedAccountWithHistory(api: APIRequestContext) {
	const account = await api.post(`${FIXTURE_API}/v1/accounts`, {
		data: {
			id: ACCOUNT_ID,
			name: "Delete history account",
			kind: "cash",
			enabled: true,
			balance: 321,
			observedAt: Math.floor(Date.parse("2026-01-31T23:59:59Z") / 1000),
		},
	});
	expect(account.ok(), await account.text()).toBe(true);
	const transaction = await api.post(`${FIXTURE_API}/v1/transactions`, {
		data: {
			name: "History transfer",
			sourceAccountId: "checking",
			destinations: [ACCOUNT_ID],
			amount: { value: 21 },
			date: "2026-02-01",
			enabled: true,
		},
	});
	expect(transaction.ok(), await transaction.text()).toBe(true);
}

test("manual account deletion cascades history and returns focus to search", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedAccountWithHistory(api);
		let deletionAccepted = false;
		await page.route("**/v1/planned-purchases", async (route) => {
			if (deletionAccepted)
				await new Promise((resolve) => setTimeout(resolve, 250));
			await route.continue();
		});
		await page.goto(`/accounts/${ACCOUNT_ID}`);
		await page.getByRole("tab", { name: "Details", exact: true }).click();
		const trigger = page.getByRole("button", {
			name: "Delete account",
			exact: true,
		});
		await expect(trigger).toBeVisible();
		await trigger.click();
		const dialog = page.getByRole("alertdialog", {
			name: "Delete Delete history account?",
		});
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("This cannot be undone.");
		await expect(
			dialog.getByRole("button", { name: "Keep account" }),
		).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();

		await trigger.click();
		const deleted = page.waitForResponse((response) => {
			if (
				new URL(response.url()).pathname === `/v1/accounts/${ACCOUNT_ID}` &&
				response.request().method() === "DELETE"
			) {
				deletionAccepted = true;
				return true;
			}
			return false;
		});
		await dialog
			.getByRole("button", { name: "Delete account", exact: true })
			.click();
		expect((await deleted).status()).toBe(200);
		await expect(page).toHaveURL(/\/accounts$/);
		await expect(page.getByPlaceholder("Find an account…")).toBeFocused();
		await expect(
			page.getByRole("region", { name: "Notifications" }),
		).toContainText("Changes saved.");
		await expect(
			page.getByText(
				"The change was saved, but the latest server data could not be reloaded. Retry the server request.",
				{ exact: true },
			),
		).toHaveCount(0);

		const model = await readSavedServerModel();
		expect(model.accounts.some((row) => row.id === ACCOUNT_ID)).toBe(false);
		expect(
			model.transactions.some((row) => row.name === "History transfer"),
		).toBe(false);
	} finally {
		await api.dispose();
	}
});

test.describe("synced account deletion", () => {
	test.use({
		fixtureOptions: {
			syncLink: {
				bridgeAccountId: "bridge-checking",
				modelAccountId: "checking",
				bridgeName: "Fixture checking",
			},
		},
	});

	test("keeps a linked account unavailable with the synced reason", async ({
		page,
	}) => {
		const deleteRequests: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "DELETE") deleteRequests.push(request.url());
		});
		await page.goto("/accounts/checking");
		await page.getByRole("tab", { name: "Details", exact: true }).click();
		const trigger = page.getByRole("button", {
			name: "Delete account",
			exact: true,
		});
		await expect(trigger).toHaveAttribute("aria-disabled", "true");
		await expect(
			page.getByText("Synced accounts cannot be deleted.", { exact: true }),
		).toBeVisible();
		await trigger.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("alertdialog")).toHaveCount(0);
		expect(deleteRequests).toEqual([]);
	});
});

test.describe("read-only workspace deletion", () => {
	test.use({ fixtureOptions: { readOnly: true } });

	test("keeps manual accounts unavailable with the workspace reason", async ({
		page,
	}) => {
		await page.goto("/accounts/checking");
		await page.getByRole("tab", { name: "Details", exact: true }).click();
		const trigger = page.getByRole("button", {
			name: "Delete account",
			exact: true,
		});
		await expect(trigger).toHaveAttribute("aria-disabled", "true");
		await expect(
			page.getByText(
				"This workspace is read-only, so accounts cannot be deleted.",
				{ exact: true },
			),
		).toBeVisible();
		await trigger.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("alertdialog")).toHaveCount(0);
	});
});
