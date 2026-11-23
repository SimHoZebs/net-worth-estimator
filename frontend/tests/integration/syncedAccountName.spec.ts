import { expect, request, test } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

// A bank-owned account is read-only for observed facts, but its display name
// is owner config. The header field must accept keyboard input on mobile and
// save through the same synced-account PATCH as kind and display basis.
test.use({
	fixtureOptions: {
		syncLink: {
			bridgeAccountId: "sf.synced.checking",
			modelAccountId: "checking",
			bridgeName: "Bank everyday checking",
			institution: "Fixture Bank",
			currency: "USD",
		},
	},
});

test("a synced account name is editable on mobile and persists", async ({
	page,
}) => {
	const seed = await request.newContext();
	try {
		const observed = await seed.post(
			`${FIXTURE_API}/__fixture/cash-observations`,
			{
				data: {
					checkpoints: [
						{
							accountId: "checking",
							postedBalance: 1608.05,
							availableBalance: 1244.43,
							observedAt: Date.parse("2026-01-01T00:00:00Z") / 1000,
						},
					],
				},
			},
		);
		expect(observed.ok(), await observed.text()).toBe(true);
	} finally {
		await seed.dispose();
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/accounts/checking");

	const name = page.getByLabel("Account name");
	await expect(name).toBeVisible();
	expect(
		await name.evaluate((element) => (element as HTMLInputElement).readOnly),
	).toBe(false);
	expect(await name.getAttribute("inputmode")).toBe("text");
	expect(await name.getAttribute("enterkeyhint")).toBe("done");

	const saved = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/v1/accounts/checking" &&
			response.request().method() === "PATCH",
	);
	await name.click();
	expect(
		await name.evaluate((element) => document.activeElement === element),
	).toBe(true);
	await name.fill("My everyday checking");
	await page.getByRole("button", { name: "Save changes" }).click();
	expect((await saved).status()).toBe(200);
	await expect(name).toHaveValue("My everyday checking");

	const api = await request.newContext();
	try {
		const response = await api.get(`${FIXTURE_API}/v1/financial-model`);
		expect(response.ok()).toBe(true);
		const { model } = await response.json();
		const stored = model.accounts.find(
			(account: { id: string }) => account.id === "checking",
		);
		expect(stored.name).toBe("My everyday checking");
	} finally {
		await api.dispose();
	}
});
