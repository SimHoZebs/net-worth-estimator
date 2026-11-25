import { expect, test, type Locator, type Page } from "./base.ts";

const ACTION_BAR = "[data-account-action-bar]";

async function openAccount(page: Page) {
	await page.goto("/accounts/checking");
	await expect(page.getByLabel("Account name")).toBeVisible();
}

async function expectNoActions(page: Page) {
	await expect(page.locator(ACTION_BAR)).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Cancel", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Save changes", exact: true }),
	).toHaveCount(0);
	const padding = await page
		.getByRole("region", { name: "Account details" })
		.evaluate((element) => getComputedStyle(element).paddingBottom);
	expect(padding).toBe("0px");
}

async function expectActions(page: Page) {
	const bar = page.locator(ACTION_BAR);
	await expect(bar).toHaveCount(1);
	await expect(bar).toBeVisible();
	await expect(bar.getByRole("button", { name: "Cancel" })).toBeVisible();
	await expect(bar.getByRole("button", { name: "Save changes" })).toBeVisible();
	return bar;
}

async function assertMobileGeometry(
	page: Page,
	safeArea = { bottom: 0, left: 0, right: 0 },
) {
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("viewport missing");
	const bar = page.locator(ACTION_BAR);
	const box = await bar.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.x).toBeLessThanOrEqual(1);
	expect(box!.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box!.x + box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
	expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 1);
	expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);

	const styles = await bar.evaluate((element) => {
		const computed = getComputedStyle(element);
		return {
			position: computed.position,
			paddingBottom: computed.paddingBottom,
			paddingLeft: computed.paddingLeft,
			paddingRight: computed.paddingRight,
		};
	});
	expect(styles.position).toBe("fixed");
	expect(styles.paddingBottom).toBe(`${Math.max(8, safeArea.bottom)}px`);
	expect(styles.paddingLeft).toBe(`${Math.max(20, safeArea.left)}px`);
	expect(styles.paddingRight).toBe(`${Math.max(20, safeArea.right)}px`);
	expect(box!.height).toBeCloseTo(64 + safeArea.bottom, 0);
	const saveBox = await bar
		.getByRole("button", { name: "Save changes" })
		.boundingBox();
	expect(saveBox).not.toBeNull();
	expect(saveBox!.x + saveBox!.width).toBeCloseTo(
		viewport.width - Math.max(20, safeArea.right),
		0,
	);

	const sectionPadding = await page
		.getByRole("region", { name: "Account details" })
		.evaluate((element) => getComputedStyle(element).paddingBottom);
	expect(sectionPadding).toBe(`${64 + safeArea.bottom}px`);
	const insideTab = await bar.evaluate((element) =>
		Boolean(element.closest('[role="tabpanel"]')),
	);
	expect(insideTab).toBe(false);

	const overflow = await page.evaluate(() => ({
		document: document.documentElement.scrollWidth,
		viewport: window.innerWidth,
	}));
	expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
	return box!;
}

async function assertInlineGeometry(page: Page, bar: Locator) {
	const tabs = page.getByRole("tablist", { name: "Account view" });
	const panel = page.getByRole("tabpanel", { name: /^Transactions/ });
	const tabBox = await tabs.boundingBox();
	const panelBox = await panel.boundingBox();
	const barBox = await bar.boundingBox();
	const rowBox = await bar.locator("..").boundingBox();
	expect(tabBox).not.toBeNull();
	expect(panelBox).not.toBeNull();
	expect(barBox).not.toBeNull();
	expect(rowBox).not.toBeNull();
	expect(
		await bar.evaluate((element) => {
			const list = document.querySelector(
				'[role="tablist"][aria-label="Account view"]',
			);
			return Boolean(list && list.parentElement === element.parentElement);
		}),
	).toBe(true);
	expect(
		await bar.evaluate((element) => {
			const panel = document.querySelector('[role="tabpanel"]');
			return panel === element.previousElementSibling;
		}),
	).toBe(true);
	expect(await tabs.locator(ACTION_BAR)).toHaveCount(0);
	expect(await tabs.locator("button:not([role='tab'])")).toHaveCount(0);
	expect(await tabs.getByRole("tab")).toHaveCount(3);

	expect(
		await bar.evaluate((element) => getComputedStyle(element).position),
	).toBe("static");
	expect(barBox!.x).toBeGreaterThanOrEqual(tabBox!.x + tabBox!.width);
	expect(barBox!.x + barBox!.width).toBeCloseTo(rowBox!.x + rowBox!.width, 0);
	expect(panelBox!.y).toBeGreaterThanOrEqual(tabBox!.y + tabBox!.height - 1);
	const tabCenter = tabBox!.y + tabBox!.height / 2;
	const barCenter = barBox!.y + barBox!.height / 2;
	expect(Math.abs(tabCenter - barCenter)).toBeLessThanOrEqual(1);
}

async function scrollToBottom(page: Page) {
	await page.evaluate(() =>
		window.scrollTo(0, document.documentElement.scrollHeight),
	);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const documentElement = document.documentElement;
				return (
					documentElement.scrollHeight -
					documentElement.scrollTop -
					documentElement.clientHeight
				);
			}),
		)
		.toBeLessThanOrEqual(2);
	return page.evaluate(() => document.documentElement.scrollTop);
}

test.describe("account detail mobile edit actions", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("renders only dirty actions and reserves safe-area space", async ({
		page,
	}) => {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Emulation.setSafeAreaInsetsOverride", {
			insets: { bottom: 34 },
		});
		await openAccount(page);
		await expectNoActions(page);

		const name = page.getByLabel("Account name");
		const originalName = await name.inputValue();
		await name.fill("Mobile checking edit");
		await expectActions(page);
		await assertMobileGeometry(page, { bottom: 34, left: 0, right: 0 });

		await name.fill(originalName);
		await expectNoActions(page);

		await page.getByRole("tab", { name: "Details", exact: true }).click();
		const protectedBalance = page.getByLabel("Protected balance in USD");
		const originalBalance = await protectedBalance.inputValue();
		await protectedBalance.fill(String(Number(originalBalance) + 1));
		await expectActions(page);
		await protectedBalance.fill(originalBalance);
		await expectNoActions(page);
		await cdp.detach();
	});

	test("keeps the last content row above the fixed actions at 320px", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 700 });
		await openAccount(page);
		await expectNoActions(page);
		await page.getByLabel("Account name").fill("Narrow checking edit");
		const before = await assertMobileGeometry(page);

		const history = page.getByRole("region", { name: "Balance history" });
		await expect(history).toBeVisible();
		expect(await scrollToBottom(page)).toBeGreaterThan(0);
		const after = await page.locator(ACTION_BAR).boundingBox();
		expect(after!.y).toBeCloseTo(before.y, 0);
		const historyBox = await history.boundingBox();
		expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual(
			after!.y + 1,
		);
	});

	test("wraps actions without adding overflow at 200% root text size", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 700 });
		await openAccount(page);
		const section = page.getByRole("region", { name: "Account details" });
		await page.evaluate(async () => {
			document.documentElement.style.fontSize = "200%";
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
		});
		const baseline = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			viewportWidth: window.innerWidth,
		}));
		const baselineOverflow = baseline.scrollWidth - baseline.viewportWidth;
		test.info().annotations.push({
			type: "baseline-overflow",
			description: `${baselineOverflow}px`,
		});

		await page.getByLabel("Account name").fill("Large text checking edit");
		const bar = await expectActions(page);
		await expect
			.poll(async () => {
				const barHeight = await bar.evaluate(
					(element) => element.getBoundingClientRect().height,
				);
				const padding = await section.evaluate((element) =>
					parseFloat(getComputedStyle(element).paddingBottom),
				);
				return Math.abs(barHeight - padding);
			})
			.toBeLessThanOrEqual(1);

		const scrollWidth = await page.evaluate(
			() => document.documentElement.scrollWidth,
		);
		expect(
			scrollWidth,
			`baseline document scrollWidth was ${baseline.scrollWidth}px`,
		).toBeLessThanOrEqual(baseline.scrollWidth);
		const barOverflow = await bar.evaluate(
			(element) => element.scrollWidth - element.clientWidth,
		);
		expect(barOverflow).toBeLessThanOrEqual(1);

		const barBox = await bar.boundingBox();
		const cancelBox = await bar
			.getByRole("button", { name: "Cancel" })
			.boundingBox();
		const saveBox = await bar
			.getByRole("button", { name: "Save changes" })
			.boundingBox();
		const rootFontSize = await page.evaluate(() =>
			parseFloat(getComputedStyle(document.documentElement).fontSize),
		);
		expect(barBox).not.toBeNull();
		expect(cancelBox).not.toBeNull();
		expect(saveBox).not.toBeNull();
		expect(barBox!.height).toBeGreaterThan(rootFontSize * 4);
		expect(saveBox!.y).toBeGreaterThan(cancelBox!.y);
		for (const box of [cancelBox!, saveBox!]) {
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(baseline.viewportWidth + 1);
		}
		const sectionPadding = await section.evaluate((element) =>
			parseFloat(getComputedStyle(element).paddingBottom),
		);
		expect(sectionPadding).toBeCloseTo(barBox!.height, 0);

		const history = page.getByRole("region", { name: "Balance history" });
		await expect(history).toBeVisible();
		expect(await scrollToBottom(page)).toBeGreaterThan(0);
		const historyBox = await history.boundingBox();
		expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual(
			barBox!.y + 1,
		);
	});

	test("confirms discard and removes the actions", async ({ page }) => {
		await openAccount(page);
		const name = page.getByLabel("Account name");
		await name.fill("Discard this checking edit");
		const bar = await expectActions(page);
		const confirm = page.getByRole("alertdialog", {
			name: "Discard unsaved changes?",
		});

		await bar.getByRole("button", { name: "Cancel" }).click();
		await expect(confirm).toBeVisible();
		await confirm.getByRole("button", { name: "Continue editing" }).click();
		await expect(confirm).toBeHidden();
		await expect(name).toHaveValue("Discard this checking edit");
		await expectActions(page);

		await bar.getByRole("button", { name: "Cancel" }).click();
		await confirm.getByRole("button", { name: "Discard changes" }).click();
		await expect(page).toHaveURL(/\/accounts$/);
		await expect(page.locator(ACTION_BAR)).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Cancel", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Save changes", exact: true }),
		).toHaveCount(0);
	});
});

test.describe("account detail desktop edit actions", () => {
	test.use({ viewport: { width: 1440, height: 1080 } });

	test("aligns one action cluster with the tab row and saves through the form", async ({
		page,
	}) => {
		await openAccount(page);
		await expectNoActions(page);
		const name = page.getByLabel("Account name");
		await name.fill("Desktop checking edit");
		const bar = await expectActions(page);
		await assertInlineGeometry(page, bar);

		const save = bar.getByRole("button", { name: "Save changes" });
		const formId = await name.getAttribute("form");
		expect(formId).not.toBeNull();
		await expect(save).toHaveAttribute("form", formId!);
		await expect(save).toHaveAttribute("type", "submit");

		let releaseSave!: () => void;
		const saveGate = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		await page.route("**/v1/accounts/checking", async (route) => {
			if (route.request().method() !== "PATCH") {
				await route.continue();
				return;
			}
			await saveGate;
			await route.continue();
		});
		const saved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/v1/accounts/checking" &&
				response.request().method() === "PATCH",
		);
		try {
			await save.click();
			await expect(bar.getByRole("button", { name: "Saving…" })).toBeVisible();
			await expect(bar.getByRole("button", { name: "Saving…" })).toBeDisabled();
			await expect(bar.getByRole("button", { name: "Cancel" })).toBeVisible();
		} finally {
			releaseSave();
		}
		expect((await saved).status()).toBe(200);
		await expect(name).toHaveValue("Desktop checking edit");
		await expectNoActions(page);
		await expect(name).toBeFocused();
	});

	test("tab order enters the selected panel before the action cluster", async ({
		page,
	}) => {
		await openAccount(page);
		await page.getByLabel("Account name").fill("Keyboard checking edit");
		const bar = await expectActions(page);
		const selectedTab = page.getByRole("tab", { name: /^Transactions/ });
		await selectedTab.focus();
		await page.keyboard.press("Tab");
		await expect(
			page.getByRole("tabpanel", { name: /^Transactions/ }),
		).toBeFocused();
		await expect(bar.getByRole("button", { name: "Cancel" })).not.toBeFocused();
	});
});

test("reverting a field leaves no stale discard guard", async ({ page }) => {
	await openAccount(page);
	const name = page.getByLabel("Account name");
	const originalName = await name.inputValue();
	const addTransaction = page.getByRole("button", {
		name: "Add transaction",
		exact: true,
	});
	await expect(addTransaction).toBeVisible();
	const discard = page.getByRole("alertdialog", {
		name: "Discard unsaved changes?",
	});

	await name.fill("Temporary checking edit");
	await addTransaction.click();
	await expect(discard).toBeVisible();
	await discard.getByRole("button", { name: "Continue editing" }).click();

	await name.fill(originalName);
	await expectNoActions(page);
	await addTransaction.click();
	await expect(
		page.getByRole("dialog", { name: "Add transaction", exact: true }),
	).toBeVisible();
	await expect(discard).toHaveCount(0);
});

test("a pending balance adjustment counts as an unsaved account edit", async ({
	page,
}) => {
	await openAccount(page);
	const balance = page.getByLabel("Balance (USD)");
	const originalBalance = await balance.inputValue();
	const adjustmentTime = page.getByLabel("Adjustment time (UTC)");
	const noOpTime = "2026-01-31T23:59:59";
	const addTransaction = page.getByRole("button", {
		name: "Add transaction",
		exact: true,
	});

	await balance.fill(String(Number(originalBalance) + 1));
	await balance.fill(originalBalance);
	await adjustmentTime.fill(noOpTime);
	await expect(page.getByText(/^Previous balance /)).toBeVisible();
	await expectNoActions(page);

	let releaseBalance!: () => void;
	const balanceGate = new Promise<void>((resolve) => {
		releaseBalance = resolve;
	});
	await page.route("**/v1/accounts/balances*", async (route) => {
		const asOf = new URL(route.request().url()).searchParams.get("asOf");
		if (asOf?.startsWith("2026-01-15T")) await balanceGate;
		await route.continue();
	});
	try {
		await adjustmentTime.fill("2026-01-15T00:00:00");
		const pendingBar = await expectActions(page);
		await expect(
			pendingBar.getByRole("button", { name: "Save changes" }),
		).toBeDisabled();
	} finally {
		releaseBalance();
	}
	await expect(page.getByText(/^Previous balance \$1,450\.00\./)).toBeVisible();
	await expectActions(page);
	await addTransaction.click();
	await expect(
		page.getByRole("alertdialog", { name: "Discard unsaved changes?" }),
	).toBeVisible();
	await page
		.getByRole("alertdialog", { name: "Discard unsaved changes?" })
		.getByRole("button", { name: "Continue editing" })
		.click();

	await adjustmentTime.fill(noOpTime);
	await expect(page.getByText(/^Previous balance /)).toBeVisible();
	await expectNoActions(page);
});

test("invalid and failed saves keep the actions and error visible", async ({
	page,
}) => {
	await openAccount(page);
	const section = page.getByRole("region", { name: "Account details" });
	const name = page.getByLabel("Account name");
	await name.fill("   ");
	let bar = await expectActions(page);
	await bar.getByRole("button", { name: "Save changes" }).click();
	await expect(section.getByRole("alert")).toHaveText(
		"Give the account a name.",
	);
	bar = await expectActions(page);

	await page.route("**/v1/accounts/checking", async (route) => {
		if (route.request().method() !== "PATCH") {
			await route.continue();
			return;
		}
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ detail: "Synthetic save failure" }),
		});
	});
	await name.fill("Failed checking save");
	const failed = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/v1/accounts/checking" &&
			response.request().method() === "PATCH",
	);
	await bar.getByRole("button", { name: "Save changes" }).click();
	expect((await failed).status()).toBe(500);
	await expect(section.getByRole("alert")).toContainText(
		"Synthetic save failure",
	);
	await expectActions(page);
	await expect(name).toHaveValue("Failed checking save");
	await expect(name).not.toBeFocused();
});
