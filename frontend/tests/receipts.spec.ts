import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resetFixture } from "./fixture.ts";

const sample = fileURLToPath(
	new URL(
		"../../backend/internal/receipts/adapters/mock/testdata/market.png",
		import.meta.url,
	),
);

test.beforeEach(async () => resetFixture());

async function seedExpense(page: Page) {
	const response = await page.request.post("/v1/postings", {
		data: {
			name: "Receipt purchase",
			sourceAccountId: "checking",
			destinations: [],
			amount: {
				resolver: "expression",
				config: { expression: "12.34" },
				inputs: {},
			},
			postedTime: Date.UTC(2026, 0, 20) / 1000,
			transactionTime: Date.UTC(2026, 0, 20) / 1000,
			enabled: true,
		},
	});
	expect(response.ok()).toBe(true);
	const body = await response.json();
	expect(body.persisted).toBe(true);
	return body.row.id as string;
}

async function openExpense(page: Page) {
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const activity = page.getByRole("dialog", { name: "Everyday checking" });
	await activity
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("Receipt purchase");
	await activity.getByRole("button", { name: /View Receipt purchase/ }).click();
	return page.getByRole("dialog", { name: /Receipt purchase/ });
}

test("private receipt upload, extraction, corrections, and reload preserve the saved plan", async ({
	page,
}) => {
	const postingId = await seedExpense(page);
	const before = await (await page.request.get("/v1/financial-model")).json();
	let assertedImage = false;
	page.on("request", (request) => {
		if (/\/v1\/receipts\/[^/]+\/image/.test(request.url()))
			assertedImage = Boolean(request.headers()["waypoint-resource"]);
	});
	const detail = await openExpense(page);
	await detail.getByLabel("Attach receipt (JPEG or PNG)").setInputFiles(sample);
	const receipt = page.getByRole("dialog", {
		name: "Receipt details",
		exact: true,
	});
	await expect(receipt).toBeVisible();
	await expect(receipt.getByRole("img")).toBeVisible();
	await receipt
		.getByRole("button", { name: "Extract details", exact: true })
		.click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Sample Market",
	);
	await expect(receipt.getByLabel("Quantity").first()).toHaveValue("1.5");
	await expect(
		receipt.getByText("Simulated data", { exact: true }).first(),
	).toHaveCount(0);
	await receipt.getByLabel("Merchant", { exact: true }).fill("Reviewed market");
	await receipt
		.getByLabel("Category", { exact: true })
		.first()
		.fill("Groceries");
	await receipt
		.getByRole("button", { name: "Confirm receipt", exact: true })
		.click();
	await expect(receipt.getByText("Receipt details saved.")).toBeVisible();
	await expect(
		receipt.getByText("Simulated data", { exact: true }).first(),
	).toHaveCount(0);
	const download = page.waitForEvent("download");
	await receipt
		.getByRole("button", { name: "Download image", exact: true })
		.click();
	expect((await download).suggestedFilename()).toBe("market.png");
	await receipt
		.getByRole("button", { name: "Close dialog", exact: true })
		.click();
	await page.reload();
	const reopened = await openExpense(page);
	await reopened.getByRole("button", { name: /Reviewed market/ }).click();
	await expect(
		receipt.getByLabel("Category", { exact: true }).first(),
	).toHaveValue("Groceries");
	await expect(receipt.getByText("Reviewed", { exact: true })).toHaveCount(0);
	expect(assertedImage).toBe(true);
	const after = await (await page.request.get("/v1/financial-model")).json();
	expect(after.revision).toBe(before.revision);
	const list = await (
		await page.request.get(`/v1/postings/${postingId}/receipts`)
	).json();
	expect(list.receipts).toHaveLength(1);
	expect(list.receipts[0].confirmed.merchant).toBe("Reviewed market");
	expect(list.receipts[0].confirmedProvenance.simulated).toBe(true);
	await receipt
		.getByLabel("Merchant", { exact: true })
		.fill("Unconfirmed market");
	await receipt
		.getByRole("button", { name: "Save draft", exact: true })
		.click();
	await expect(receipt.getByText("Receipt details saved.")).toBeVisible();
	await expect(receipt.getByText("Reviewed", { exact: true })).toHaveCount(0);
	await page.reload();
	const withDraft = await openExpense(page);
	await withDraft
		.getByRole("button", { name: /Unconfirmed market.*Draft saved/ })
		.click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Unconfirmed market",
	);
	await expect(receipt.getByText("Draft saved", { exact: true })).toHaveCount(
		0,
	);
});

test("reopened extraction polls only reads and exposes interrupted recovery", async ({
	page,
}) => {
	const postingId = await seedExpense(page);
	const detail = await openExpense(page);
	await detail.getByLabel("Attach receipt (JPEG or PNG)").setInputFiles(sample);
	const receipt = page.getByRole("dialog", {
		name: "Receipt details",
		exact: true,
	});
	await expect(receipt).toBeVisible();
	await receipt
		.getByRole("button", { name: "Close dialog", exact: true })
		.click();
	const collection = await (
		await page.request.get(`/v1/postings/${postingId}/receipts`)
	).json();
	const id = collection.receipts[0].id as string;
	let phase = "extracting";
	let reads = 0;
	let extractionPosts = 0;
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			request.url().endsWith(`/v1/receipts/${id}/extract`)
		)
			extractionPosts++;
	});
	// Replay durable read states without a real one-minute delay or provider call.
	await page.route(`**/v1/receipts/${id}`, async (route) => {
		const response = await route.fetch();
		const body = await response.json();
		body.receipt.status = phase;
		reads++;
		await route.fulfill({ response, json: body });
	});
	await page.reload();
	const reopened = await openExpense(page);
	await reopened.getByRole("button", { name: /market.png/ }).click();
	await expect(
		receipt.getByText("Scanning the receipt.", { exact: false }),
	).toBeVisible();
	await expect(
		receipt.getByRole("button", { name: "Extracting details…", exact: true }),
	).toBeDisabled();
	phase = "interrupted";
	await expect(
		receipt.getByText("The previous extraction was interrupted.", {
			exact: false,
		}),
	).toBeVisible();
	await expect(
		receipt.getByRole("button", { name: "Extract details", exact: true }),
	).toBeEnabled();
	expect(reads).toBeGreaterThan(1);
	expect(extractionPosts).toBe(0);
	await page.unroute(`**/v1/receipts/${id}`);
	await receipt
		.getByRole("button", { name: "Extract details", exact: true })
		.click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Sample Market",
	);
	expect(extractionPosts).toBe(1);
});

test("extraction gives immediate busy feedback until the OCR response completes", async ({
	page,
}) => {
	await seedExpense(page);
	const detail = await openExpense(page);
	await detail.getByLabel("Attach receipt (JPEG or PNG)").setInputFiles(sample);
	const receipt = page.getByRole("dialog", {
		name: "Receipt details",
		exact: true,
	});
	const idle = receipt.getByRole("button", {
		name: "Extract details",
		exact: true,
	});
	const idleColor = await idle.evaluate(
		(button) => getComputedStyle(button).backgroundColor,
	);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let posts = 0;
	await page.route("**/v1/receipts/*/extract", async (route) => {
		posts++;
		const response = await route.fetch();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await idle.click();
		const pending = receipt.getByRole("button", {
			name: "Extracting details…",
			exact: true,
		});
		await expect(pending).toBeDisabled();
		await expect(pending).toHaveAttribute("aria-busy", "true");
		await expect(pending.locator("progress")).toBeVisible();
		expect(
			await pending.evaluate(
				(button) => getComputedStyle(button).backgroundColor,
			),
		).not.toBe(idleColor);
		await expect(
			receipt.getByText("Scanning the receipt. Your attachment is saved."),
		).toBeVisible();
		await expect(
			receipt.getByLabel("Merchant", { exact: true }),
		).toBeDisabled();
		expect(posts).toBe(1);
	} finally {
		release();
	}
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Sample Market",
	);
	await expect(
		receipt.getByText(
			"Receipt details extracted. Review them before you confirm.",
		),
	).toBeVisible();
	await expect(idle).toBeEnabled();
	await expect(idle).toHaveAttribute("aria-busy", "false");
});

test("unknown images recover through manual review and drafts survive reload", async ({
	page,
}) => {
	const id = await seedExpense(page);
	const detail = await openExpense(page);
	const unknownImage = await page.screenshot();
	await detail.getByLabel("Attach receipt (JPEG or PNG)").setInputFiles({
		name: "other.png",
		mimeType: "image/png",
		buffer: unknownImage,
	});
	const receipt = page.getByRole("dialog", {
		name: "Receipt details",
		exact: true,
	});
	await receipt
		.getByRole("button", { name: "Extract details", exact: true })
		.click();
	await expect(
		receipt.getByText(
			"Extraction is unavailable for this image. Enter receipt details manually.",
		),
	).toBeVisible();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue("");
	await expect(
		receipt.getByRole("button", { name: "Extract details", exact: true }),
	).toBeEnabled();
	await expect(
		receipt.getByRole("button", { name: "Extract details", exact: true }),
	).toHaveAttribute("aria-busy", "false");
	await receipt.getByLabel("Merchant", { exact: true }).fill("Manual draft");
	await receipt
		.getByRole("button", { name: "Save draft", exact: true })
		.click();
	await expect(receipt.getByText("Receipt details saved.")).toBeVisible();
	await page.reload();
	const again = await openExpense(page);
	await again.getByRole("button", { name: /Manual draft/ }).click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Manual draft",
	);
	await receipt.getByLabel("Receipt date", { exact: true }).fill("2026-01-20");
	await receipt.getByLabel("Total (USD)", { exact: true }).fill("12.34");
	await receipt
		.getByRole("button", { name: "Confirm receipt", exact: true })
		.click();
	await expect(receipt.getByText("Receipt details saved.")).toBeVisible();
	await receipt
		.getByRole("button", { name: "Delete receipt", exact: true })
		.click();
	const confirm = page.getByRole("dialog", { name: "Delete this receipt?" });
	await confirm
		.getByRole("button", { name: "Delete receipt", exact: true })
		.click();
	await expect(receipt).toHaveCount(0);
	const list = await (
		await page.request.get(`/v1/postings/${id}/receipts`)
	).json();
	expect(list.receipts).toHaveLength(0);
});

test("receipt review supports narrow screens, keyboard dismissal, and accessible forms", async ({
	page,
}) => {
	await seedExpense(page);
	await page.setViewportSize({ width: 390, height: 844 });
	const detail = await openExpense(page);
	await detail.getByLabel("Attach receipt (JPEG or PNG)").setInputFiles(sample);
	const receipt = page.getByRole("dialog", {
		name: "Receipt details",
		exact: true,
	});
	await receipt
		.getByRole("button", { name: "Extract details", exact: true })
		.click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Sample Market",
	);
	expect(
		await receipt.evaluate(
			(element) => element.scrollWidth <= element.clientWidth,
		),
	).toBe(true);
	const results = await new AxeBuilder({ page })
		.include("dialog[open]:last-of-type")
		.analyze();
	expect(results.violations).toEqual([]);
	await receipt.getByLabel("Merchant", { exact: true }).fill("Unsaved edit");
	await page.keyboard.press("Escape");
	await expect(
		receipt.getByText("Discard unsaved receipt edits?"),
	).toBeVisible();
	await receipt
		.getByRole("button", { name: "Continue editing", exact: true })
		.click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Unsaved edit",
	);
	await receipt
		.getByRole("button", { name: "Discard edits", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await expect(receipt).toHaveCount(0);
});

test("read-only plans keep receipt mutations unavailable", async ({ page }) => {
	await resetFixture({ readOnly: true });
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const activity = page.getByRole("dialog", { name: "Everyday checking" });
	await activity.getByLabel("Transaction source").selectOption("all");
	await activity
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("renovation");
	await activity.getByRole("button", { name: /View Home renovation/ }).click();
	await expect(
		page.getByRole("region", { name: "Receipt evidence" }),
	).toBeVisible();
	await expect(page.getByLabel("Attach receipt (JPEG or PNG)")).toHaveCount(0);
	const rejected = await page.request.post("/v1/receipts/missing/extract");
	expect(rejected.status()).toBe(403);
});

test("image controls replace all receipt content and delete it without changing the transaction", async ({
	page,
}) => {
	const postingId = await seedExpense(page);
	const before = await (await page.request.get("/v1/financial-model")).json();
	const detail = await openExpense(page);
	await detail.getByLabel("Attach receipt (JPEG or PNG)").setInputFiles(sample);
	const receipt = page.getByRole("dialog", {
		name: "Receipt details",
		exact: true,
	});
	await expect(
		receipt.getByText(/Private attachment|Simulated data|TRANSACTION EVIDENCE/),
	).toHaveCount(0);
	await receipt
		.getByRole("button", { name: "Extract details", exact: true })
		.click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Sample Market",
	);
	await receipt
		.getByRole("button", { name: "Confirm receipt", exact: true })
		.click();
	await expect(receipt.getByText("Receipt details saved.")).toBeVisible();
	const original = await (
		await page.request.get(`/v1/postings/${postingId}/receipts`)
	).json();
	const id = original.receipts[0].id as string;
	const oldPixels = await receipt.getByRole("img").getAttribute("src");
	await receipt
		.getByLabel("Merchant", { exact: true })
		.fill("Unsaved correction");
	const replacementPixels = await page.screenshot();
	const picker = receipt.getByLabel("Replace receipt image", { exact: true });
	await picker.setInputFiles({
		name: "replacement.png",
		mimeType: "image/png",
		buffer: replacementPixels,
	});
	const replace = page.getByRole("dialog", {
		name: "Replace this receipt?",
		exact: true,
	});
	await expect(replace.getByText(/clears extracted details/)).toBeVisible();
	await replace
		.getByRole("button", { name: "Keep receipt", exact: true })
		.click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Unsaved correction",
	);
	await picker.setInputFiles({
		name: "invalid.png",
		mimeType: "image/png",
		buffer: Buffer.from("invalid PNG"),
	});
	await replace
		.getByRole("button", { name: "Replace receipt", exact: true })
		.click();
	await expect(replace.getByRole("alert")).toContainText(
		"Choose a valid JPEG or PNG",
	);
	await replace
		.getByRole("button", { name: "Keep receipt", exact: true })
		.click();
	await expect(receipt.getByRole("img")).toHaveAttribute("src", oldPixels!);
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue(
		"Unsaved correction",
	);
	await picker.setInputFiles({
		name: "replacement.png",
		mimeType: "image/png",
		buffer: replacementPixels,
	});
	await replace
		.getByRole("button", { name: "Replace receipt", exact: true })
		.click();
	await expect(replace).toHaveCount(0);
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue("");
	await expect(receipt.getByRole("img")).toHaveAttribute(
		"alt",
		"Receipt: replacement.png",
	);
	await expect(receipt.getByRole("img")).not.toHaveAttribute("src", oldPixels!);
	await expect(
		receipt.getByText("Original extracted values", { exact: true }),
	).toHaveCount(0);
	const updated = await (
		await page.request.get(`/v1/postings/${postingId}/receipts`)
	).json();
	expect(updated.receipts).toHaveLength(1);
	expect(updated.receipts[0].id).toBe(id);
	for (const field of [
		"extraction",
		"draft",
		"confirmed",
		"problem",
		"draftProvenance",
		"confirmedProvenance",
	])
		expect(updated.receipts[0][field]).toBeUndefined();
	await page.reload();
	const reopened = await openExpense(page);
	await reopened.getByRole("button", { name: /replacement.png/ }).click();
	await expect(receipt.getByLabel("Merchant", { exact: true })).toHaveValue("");
	await receipt
		.getByRole("button", { name: "Delete receipt", exact: true })
		.click();
	const remove = page.getByRole("dialog", {
		name: "Delete this receipt?",
		exact: true,
	});
	await remove
		.getByRole("button", { name: "Keep receipt", exact: true })
		.click();
	await expect(receipt.getByRole("img")).toBeVisible();
	await receipt
		.getByRole("button", { name: "Delete receipt", exact: true })
		.click();
	await remove
		.getByRole("button", { name: "Delete receipt", exact: true })
		.click();
	await expect(receipt).toHaveCount(0);
	expect((await page.request.get(`/v1/receipts/${id}/image`)).status()).toBe(
		404,
	);
	const list = await (
		await page.request.get(`/v1/postings/${postingId}/receipts`)
	).json();
	expect(list.receipts).toHaveLength(0);
	const after = await (await page.request.get("/v1/financial-model")).json();
	expect(after.revision).toBe(before.revision);
});
