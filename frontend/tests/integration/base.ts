import {
	expect,
	test as base,
	type BrowserContext,
	type Page,
} from "@playwright/test";
import { resetFixture, type FixtureOptions } from "./fixture.ts";

export {
	expect,
	request,
	type APIRequestContext,
	type Locator,
	type Page,
} from "@playwright/test";

type Guards = {
	reportBrowserErrors: void;
	fixtureBaseline: void;
	fixtureOptions: FixtureOptions;
};

function attachBrowserErrorWatchers(
	target: {
		pages: () => Page[];
		on: (event: "page", listener: (page: Page) => void) => void;
	},
	problems: string[],
): void {
	const watch = (page: Page) => {
		page.on("console", (message) => {
			if (message.type() !== "error") return;
			const text = message.text();
			if (text.startsWith("Failed to load resource:")) return;
			const location = message.location();
			problems.push(
				`console.error: ${text}${location ? ` at ${location.url}:${location.lineNumber}` : ""}`,
			);
		});
		page.on("pageerror", (error) => {
			problems.push(
				`pageerror: ${error.message}${error.stack ? `\n${error.stack}` : ""}`,
			);
		});
	};
	for (const existing of target.pages()) watch(existing);
	target.on("page", watch);
}

function assertNoBrowserErrors(problems: string[]): void {
	expect(problems, `browser reported errors:\n${problems.join("\n")}`).toEqual(
		[],
	);
}

// An uncaught exception or an app-level console error is invisible to most
// assertions. Background work that fails silently would otherwise leave the
// test green, so the shared context reports every page's browser errors at
// teardown, including second tabs opened mid-test. The browser's own
// "Failed to load resource" line is skipped: it reports a request status,
// and the suite injects those failures on purpose.
export const test = base.extend<Guards>({
	fixtureOptions: [{}, { option: true }],
	fixtureBaseline: [
		async ({ fixtureOptions }, use) => {
			await resetFixture(fixtureOptions);
			await use();
		},
		{ auto: true },
	],
	reportBrowserErrors: [
		async ({ context }, use) => {
			const problems: string[] = [];
			attachBrowserErrorWatchers(context, problems);
			await use();
			assertNoBrowserErrors(problems);
		},
		{ auto: true },
	],
});

// Specs that open their own browser contexts report them explicitly:
// the shared fixture only sees its own context.
export function trackBrowserErrors(context: BrowserContext): () => void {
	const problems: string[] = [];
	attachBrowserErrorWatchers(context, problems);
	return () => assertNoBrowserErrors(problems);
}
