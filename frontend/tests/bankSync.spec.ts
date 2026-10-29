import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

// Only the provider is simulated. Authentication, the workspace, and financial
// data use the isolated fixture API. No real bank credentials leave the browser.
async function stubSimplefin(
	page: Page,
	options: {
		configured?: boolean;
		empty?: boolean;
		syncEnabled?: boolean;
		rejectFirstToken?: boolean;
		throttle?: boolean;
		holdConnect?: boolean;
	} = {},
) {
	let configured = options.configured ?? false;
	let syncCalls = 0;
	const credentials: Record<string, string>[] = [];
	let releaseConnect = () => {};
	const pendingConnect = options.holdConnect
		? new Promise<void>((resolve) => {
				releaseConnect = resolve;
			})
		: Promise.resolve();
	const response = await page.request.get("/v1/sync/simplefin/credential");
	const headers = response.headers();
	await page.route("**/v1/sync/simplefin/credential", async (route) => {
		if (route.request().method() === "POST") {
			const input = route.request().postDataJSON();
			credentials.push(input);
			await pendingConnect;
			if (options.rejectFirstToken && credentials.length === 1) {
				await route.fulfill({
					status: 400,
					headers,
					json: { detail: "The setup token could not be accepted." },
				});
				return;
			}
			configured = true;
		} else if (route.request().method() === "DELETE") configured = false;
		await route.fulfill({
			headers,
			json: configured
				? {
						configured: true,
						bridgeHost: "bridge.example",
						updatedAt: "2026-10-26T12:00:00Z",
					}
				: { configured: false },
		});
	});
	await page.route("**/v1/status", async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			json: {
				...(await response.json()),
				syncConfigured: configured && options.syncEnabled !== false,
				...(configured && !options.empty
					? { lastSyncAt: "2026-10-26T12:01:00Z" }
					: {}),
				syncQuotaUsed: 1,
				syncQuotaLimit: 24,
			},
		});
	});
	await page.route("**/v1/sync/simplefin/accounts", async (route) => {
		await route.fulfill({
			headers,
			json: {
				links:
					configured && !options.empty
						? [
								{
									bridgeAccountId: "bridge-checking",
									modelAccountId: "checking",
									bridgeName: "Bank checking",
									currency: "USD",
									origin: "auto",
									lastSeenAt: "2026-10-26T12:01:00Z",
								},
							]
						: [],
			},
		});
	});
	await page.route("**/v1/sync/simplefin", async (route) => {
		syncCalls++;
		await route.fulfill(
			options.throttle
				? {
						status: 429,
						headers: { ...headers, "Retry-After": "3600" },
						json: { detail: "Sync ran recently. Try again in one hour." },
					}
				: {
						headers,
						json: {
							checkpointsInserted: 0,
							checkpointsUpdated: 0,
							checkpointsSkipped: 0,
							pendingDeleted: 0,
							pendingInserted: 0,
							pendingUpdated: 0,
							accountsProvisioned: 0,
							skipped: {},
						},
					},
		);
	});
	return {
		credentials,
		releaseConnect: () => releaseConnect(),
		syncCalls: () => syncCalls,
	};
}

test.beforeEach(async () => {
	await resetFixture();
});

for (const width of [1440, 390, 320]) {
	test(`setup is accessible and fits at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/#sources");
		const bankSync = page.getByRole("region", {
			name: "Bank sync",
			exact: true,
		});
		await expect(
			bankSync
				.getByRole("list", { name: "SimpleFIN setup steps" })
				.getByRole("listitem"),
		).toHaveCount(3);
		await expect(
			bankSync.getByText(/separate paid subscription/),
		).toBeVisible();
		for (const name of [
			/Open SimpleFIN/,
			/Check bank support/,
			/Create a setup token/,
		]) {
			const link = bankSync.getByRole("link", { name });
			await expect(link).toHaveAttribute("target", "_blank");
			await expect(link).toHaveAttribute("rel", "noopener noreferrer");
		}
		await bankSync
			.getByRole("button", { name: "I already have a token" })
			.click();
		const token = bankSync.getByLabel("Setup token", { exact: true });
		await expect(token).toBeFocused();
		await expect(token).toBeInViewport();
		await expect(token).toHaveAttribute("type", "password");
		await token.press("Enter");
		await expect(token).toBeFocused();
		await expect(
			bankSync.getByText("Not connected", { exact: true }),
		).toBeVisible();
		await bankSync.getByRole("button", { name: "Show token" }).click();
		await expect(token).toHaveAttribute("type", "text");
		await bankSync.getByRole("button", { name: "Hide token" }).click();
		await expect(token).toHaveAttribute("type", "password");
		await bankSync
			.getByText("My setup token did not work", { exact: true })
			.click();
		await expect(
			bankSync.getByText(
				/Create a new app connection for Waypoint in SimpleFIN/,
			),
		).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		const audit = await new AxeBuilder({ page })
			.include('[aria-label="Bank sync"]')
			.withTags(["wcag2a", "wcag2aa"])
			.analyze();
		expect(audit.violations).toEqual([]);
	});
}

test("connects by keyboard, protects the pending request, and confirms imported accounts", async ({
	page,
}) => {
	const provider = await stubSimplefin(page, { holdConnect: true });
	await page.goto("/#sources");
	const bankSync = page.getByRole("region", { name: "Bank sync", exact: true });
	await bankSync.getByLabel("Setup token", { exact: true }).fill(" dG9rZW4= ");
	await bankSync.getByLabel("Setup token", { exact: true }).press("Enter");
	await expect(
		bankSync.getByRole("button", { name: "Connecting…" }),
	).toBeDisabled();
	await expect(
		bankSync.getByLabel("Setup token", { exact: true }),
	).toBeDisabled();
	await expect(
		bankSync.getByRole("button", { name: "Show token" }),
	).toBeDisabled();
	provider.releaseConnect();
	await expect(bankSync.getByText("Connected", { exact: true })).toBeVisible();
	await expect(
		bankSync.getByRole("heading", { name: "SimpleFIN" }),
	).toBeFocused();
	await expect(
		bankSync.getByRole("list", { name: "Synced accounts" }),
	).toContainText("Everyday checking");
	await expect(bankSync.locator("time")).toHaveAttribute(
		"datetime",
		"2026-10-26T12:01:00Z",
	);
	expect(provider.credentials).toEqual([{ setupToken: "dG9rZW4=" }]);
	await bankSync
		.getByRole("button", { name: "Disconnect", exact: true })
		.click();
	await expect(bankSync.getByText(/Future imports will stop/)).toBeVisible();
	await bankSync.getByRole("button", { name: "Confirm disconnect" }).click();
	await expect(bankSync.getByRole("status")).toContainText(
		"Your accounts and imported history are kept",
	);
	await expect(bankSync.getByLabel("Setup token", { exact: true })).toHaveValue(
		"",
	);
	await expect(
		bankSync.getByRole("heading", { name: "Connect bank accounts" }),
	).toBeFocused();
});

test("explains a rejected token and recovers with a new setup token", async ({
	page,
}) => {
	const provider = await stubSimplefin(page, { rejectFirstToken: true });
	await page.goto("/#sources");
	const bankSync = page.getByRole("region", { name: "Bank sync", exact: true });
	const form = bankSync.getByRole("form", { name: "Connect SimpleFIN" });
	await form.getByLabel("Setup token", { exact: true }).fill("invalid-token");
	await form.getByLabel("Setup token", { exact: true }).press("Enter");
	await expect(form.getByRole("alert")).toContainText(
		"Copy the entire setup token from SimpleFIN",
	);
	await expect(form.getByLabel("Setup token", { exact: true })).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	const token = form.getByLabel("Setup token", { exact: true });
	await token.fill("replacement-token");
	await expect(form.getByRole("alert")).toHaveCount(0);
	await token.press("Enter");
	await expect(bankSync.getByText("Connected", { exact: true })).toBeVisible();
	expect(provider.credentials).toEqual([
		{ setupToken: "invalid-token" },
		{ setupToken: "replacement-token" },
	]);
	expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
		"replacement-token",
	);
});

test("distinguishes a saved credential from unavailable sync and missing accounts", async ({
	page,
}) => {
	await stubSimplefin(page, {
		configured: true,
		empty: true,
		syncEnabled: false,
	});
	await page.goto("/#sources");
	const bankSync = page.getByRole("region", { name: "Bank sync", exact: true });
	await expect(
		bankSync.getByText(/the server has not enabled sync for this plan/),
	).toBeVisible();
	await expect(bankSync.getByText("No synced accounts yet.")).toBeVisible();
	await expect(
		bankSync.getByRole("button", { name: "Sync now" }),
	).toBeDisabled();
	await expect(bankSync.locator("time")).toHaveCount(0);
});

test("explains sync limits without retrying the provider automatically", async ({
	page,
}) => {
	const provider = await stubSimplefin(page, {
		configured: true,
		empty: true,
		throttle: true,
	});
	await page.goto("/#sources");
	const bankSync = page.getByRole("region", { name: "Bank sync", exact: true });
	await bankSync.getByRole("button", { name: "Sync now" }).click();
	await expect(bankSync.getByRole("alert")).toContainText(
		"wait before you try again",
	);
	expect(provider.syncCalls()).toBe(1);
	await expect(bankSync.getByRole("status")).not.toContainText("Sync complete");
});

test("connected accounts and sync feedback stay accessible in dark mode on mobile", async ({
	page,
}) => {
	await stubSimplefin(page, { configured: true });
	await page.emulateMedia({ colorScheme: "dark" });
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto("/#sources");
	const bankSync = page.getByRole("region", { name: "Bank sync", exact: true });
	await expect(
		bankSync.getByRole("list", { name: "Synced accounts" }),
	).toContainText("Everyday checking");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await bankSync.getByRole("button", { name: "Sync now" }).click();
	await expect(bankSync.getByRole("status")).toContainText("Sync complete");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	const audit = await new AxeBuilder({ page })
		.include('[aria-label="Bank sync"]')
		.withTags(["wcag2a", "wcag2aa"])
		.analyze();
	expect(audit.violations).toEqual([]);
});
