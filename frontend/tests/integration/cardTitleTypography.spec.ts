import { expect, test, type Locator } from "./base.ts";

// Observed after the Card slot migration: titles composed as native headings
// (CardTitle > h2/h3 for outline semantics) rendered in the global h2/h6
// base styles — Geist, small/bold — instead of the canonical CardTitle
// composition (Merriweather, medium). CardTitle now owns a direct-child
// inheritance rule, so nested headings keep their level, ID, and layout
// while matching direct-text titles.
async function expectLoadedCard(card: Locator) {
	// The pending skeleton carries aria-busy; pin the loaded branch before
	// snapshotting so a background data window cannot swap the card under a
	// dataset mutation. Same gate as the net-worth header regression spec.
	await expect(card.locator('[aria-busy="true"]')).toHaveCount(0);
}

async function expectCanonicalTitle(
	title: Locator,
	parent: Locator,
	expectedSize: string,
) {
	// Auto-retry gate: absorb style-application timing after a dataset flip
	// before snapshotting. The exact assertions below stay synchronous.
	await expect(title).toHaveCSS("font-size", expectedSize);
	await expect(title).toBeVisible();
	const [child, ancestor] = await Promise.all([
		title.evaluate((el) => {
			const style = getComputedStyle(el);
			return {
				family: style.fontFamily,
				size: style.fontSize,
				weight: style.fontWeight,
				lineHeight: style.lineHeight,
				letterSpacing: style.letterSpacing,
			};
		}),
		parent.evaluate((el) => {
			const style = getComputedStyle(el);
			return {
				family: style.fontFamily,
				size: style.fontSize,
				weight: style.fontWeight,
				lineHeight: style.lineHeight,
				letterSpacing: style.letterSpacing,
			};
		}),
	]);
	// The heading inherits the CardTitle composition exactly.
	expect(child).toEqual(ancestor);
	// And that composition is the canonical one, not the global base style:
	// no tracking-tight from the h2 base rule either.
	expect(ancestor.letterSpacing).toBe("normal");
	expect(child.family).toMatch(/Merriweather/);
	expect(child.size).toBe(expectedSize);
	expect(child.weight).toBe("500");
}

test("safe-spending card title heading matches the canonical composition", async ({
	page,
}) => {
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	const title = card.locator(
		':scope > [data-slot="card-header"] > [data-slot="card-title"]',
	);
	await expect(title).toHaveCount(1);
	const heading = title.getByRole("heading", { name: "Safe spending" });
	await expectLoadedCard(card);
	await expectCanonicalTitle(heading, title, "16px");
	// Layout, identity, and semantics survive the inheritance rule.
	await expect(heading).toHaveClass(/flex/);
	expect(await heading.evaluate((el) => el.tagName)).toBe("H2");
});

// No production sm CardTitle nests a native heading, so the sm proof flips
// only the presentational data-size attribute on the existing card — the Card
// size prop maps directly to it — with no financial state or fabricated UI.
test("safe-spending card title heading inherits the sm composition", async ({
	page,
}) => {
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	const title = card.locator(
		':scope > [data-slot="card-header"] > [data-slot="card-title"]',
	);
	const heading = title.getByRole("heading", { name: "Safe spending" });
	await expectLoadedCard(card);
	await expectCanonicalTitle(heading, title, "16px");
	await card.evaluate((el) => {
		el.setAttribute("data-size", "sm");
	});
	await expectLoadedCard(card);
	await expectCanonicalTitle(heading, title, "14px");
	await expect(heading).toHaveClass(/flex/);
	expect(await heading.evaluate((el) => el.tagName)).toBe("H2");
	await card.evaluate((el) => {
		el.setAttribute("data-size", "default");
	});
	await expectLoadedCard(card);
	await expectCanonicalTitle(heading, title, "16px");
});

test.describe("card title heading narrow layout", () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test("safe-spending card title heading matches the canonical composition", async ({
		page,
	}) => {
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		const title = card.locator(
			':scope > [data-slot="card-header"] > [data-slot="card-title"]',
		);
		const heading = title.getByRole("heading", {
			name: "Safe spending",
		});
		await expectLoadedCard(card);
		await expectCanonicalTitle(heading, title, "16px");
	});
});
