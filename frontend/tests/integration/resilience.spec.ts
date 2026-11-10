import { expect, test } from "./base.ts";
import { readSavedServerModel } from "./fixture.ts";

// Chromium holds a fetch that starts while the context is offline and releases
// it on reconnect, so this covers the deferred-save path: the edit must stay,
// no false success may appear, and the write must land once the network
// returns.
test("a dropped connection keeps the edit and finishes the save on reconnect", async ({
	page,
	context,
}) => {
	await page.goto("/transactions?editor=transaction&id=invest");
	await page.getByLabel("Amount (USD)").click();
	await page.getByLabel("Amount (USD)").fill("910");

	await context.setOffline(true);
	await page.getByRole("button", { name: "Save changes" }).click();
	// The form stays open with the attempted value, and the pending write is
	// visible as a disabled action rather than a success notice.
	await expect(
		page.getByRole("button", { name: "Save changes" }),
	).toBeDisabled();
	await expect(page.getByLabel("Amount (USD)")).toHaveValue("910");
	await expect(page.getByText("Changes saved.")).toHaveCount(0);
	expect(
		(await readSavedServerModel()).schedules.find(
			(rule) => rule.id === "invest",
		)?.amount.config.expression,
	).toBe("600");

	await context.setOffline(false);
	await expect(page.getByText("Changes saved.")).toBeVisible();
	expect(
		(await readSavedServerModel()).schedules.find(
			(rule) => rule.id === "invest",
		)?.amount.config.expression,
	).toBe("910");
});
