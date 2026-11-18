import { expect, request, test, type Locator } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

// Observed in hosted E2E (secondUserSignup): the signup landing's
// "Your workspace is ready" empty title lost its heading role when the slot
// migration removed the nested native h3 as an old recipe, leaving direct
// text in a div. EmptyTitle now renders h3 by default, so the title keeps its
// heading role with the preset appearance (the title utilities override the
// global h3 base).
async function seedBlankModel(): Promise<void> {
	const api = await request.newContext();
	try {
		const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
		if (!read.ok()) throw new Error(`model read failed: ${read.status()}`);
		const { model } = (await read.json()) as {
			model: Record<string, unknown>;
		};
		const evaluations = Object.fromEntries(
			Object.entries((model.evaluations ?? {}) as Record<string, unknown>).map(
				([key]) => [key, []],
			),
		);
		const blank: Record<string, unknown> = { ...model, evaluations };
		for (const key of [
			"accounts",
			"checkpoints",
			"transactions",
			"schedules",
			"paymentTerms",
			"plannedPurchases",
		]) {
			if (key in blank) blank[key] = [];
		}
		const response = await api.post(`${FIXTURE_API}/v1/model/import`, {
			data: { model: blank },
		});
		if (!response.ok())
			throw new Error(
				`model import failed: ${response.status()} ${await response.text()}`,
			);
		const body = (await response.json()) as {
			saved: boolean;
			issues: unknown[];
		};
		expect(body.saved).toBe(true);
		expect(body.issues).toEqual([]);
	} finally {
		await api.dispose();
	}
}

async function expectEmptyTitle(title: Locator) {
	await expect(title).toBeVisible();
	expect(await title.evaluate((el) => el.tagName)).toBe("H3");
	// No nested heading: the title itself carries the role.
	await expect(title.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(0);
	const style = await title.evaluate((el) => {
		const computed = getComputedStyle(el);
		return {
			family: computed.fontFamily,
			size: computed.fontSize,
			weight: computed.fontWeight,
			letterSpacing: computed.letterSpacing,
		};
	});
	expect(style.family).toMatch(/Merriweather/);
	expect(style.size).toBe("14px");
	expect(style.weight).toBe("500");
	// tracking-tight resolves against the 14px size, unlike the global h3
	// base which leaves letter-spacing normal.
	expect(Number.parseFloat(style.letterSpacing)).toBeCloseTo(-0.35, 1);
}

test("outlook empty title keeps heading role with preset appearance", async ({
	page,
}) => {
	await seedBlankModel();
	await page.goto("/outlook");
	await expectEmptyTitle(
		page.getByRole("heading", { name: "Your workspace is ready" }),
	);
});
