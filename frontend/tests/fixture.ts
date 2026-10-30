import { type Page, request } from "@playwright/test";

// The fixtureapi harness owns the recorded baseline. Resetting before each
// test keeps server state from leaking between tests that save.
export const FIXTURE_API =
	process.env.FIXTURE_API_ORIGIN ??
	`http://127.0.0.1:${process.env.TEST_API_PORT ?? 8799}`;

export const REMOTE_STORAGE_KEY = "waypoint.remote-workspace.v1";

type FixtureResource = { id: string };

async function fixtureResource(page: Page): Promise<FixtureResource> {
	const response = await page.request.get("/v1/auth/session");
	if (!response.ok())
		throw new Error(`fixture session failed: ${response.status()}`);
	return (await response.json()).resource as FixtureResource;
}

/** Seed this fixture user without overwriting changes on browser reload. */
export async function seedResourceStorage(
	page: Page,
	baseKey: string,
	raw: string,
): Promise<void> {
	await page.addInitScript(
		({ baseKey, raw, resource }) => {
			const key = `${baseKey}:user:${encodeURIComponent(window.location.origin)}:${encodeURIComponent(resource.id)}`;
			if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
		},
		{ baseKey, raw, resource: await fixtureResource(page) },
	);
}

export async function resetFixture(
	options: { readOnly?: boolean; pinnedEvaluationIds?: string[] } = {},
): Promise<void> {
	const api = await request.newContext();
	try {
		const response = await api.post(`${FIXTURE_API}/__fixture/reset`, {
			data: { readOnly: options.readOnly ?? false },
		});
		if (!response.ok())
			throw new Error(
				`fixture reset failed: ${response.status()} ${await response.text()}`,
			);
		if (options.pinnedEvaluationIds) {
			const pins = await api.put(`${FIXTURE_API}/v1/pinned-evaluations`, {
				data: { instanceIds: options.pinnedEvaluationIds },
			});
			if (!pins.ok()) throw new Error(`fixture pins failed: ${pins.status()}`);
		}
	} finally {
		await api.dispose();
	}
}

export async function readSavedServerModel() {
	const api = await request.newContext();
	try {
		const response = await api.get(`${FIXTURE_API}/v1/financial-model`);
		if (!response.ok())
			throw new Error(`model read failed: ${response.status()}`);
		const body = await response.json();
		type transaction = {
			id: string;
			name: string;
			amount: { config: { expression?: string } };
			purchase?: { priority: number };
		};
		type account = { id: string; minBalance: number };
		return {
			accounts: body.document.accounts as account[],
			postings: body.document.postings as transaction[],
			recurrenceRules: (body.document.recurrenceRules ?? []) as transaction[],
		};
	} finally {
		await api.dispose();
	}
}
