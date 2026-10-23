import { type Page, request } from "@playwright/test";

// The fixtureapi harness owns the recorded baseline. Resetting before each
// test keeps server state from leaking between tests that save.
export const FIXTURE_API =
	process.env.FIXTURE_API_ORIGIN ?? "http://127.0.0.1:8799";

export const REMOTE_STORAGE_KEY = "waypoint.remote-workspace.v1";

type FixtureResource = { id: string; kind: "private" | "sample" };

async function fixtureResource(page: Page): Promise<FixtureResource> {
	const response = await page.request.get("/v1/auth/session");
	if (!response.ok())
		throw new Error(`fixture session failed: ${response.status()}`);
	return (await response.json()).resource as FixtureResource;
}

/** Seed this fixture account without overwriting changes on browser reload. */
export async function seedResourceStorage(
	page: Page,
	baseKey: string,
	raw: string,
): Promise<void> {
	await page.addInitScript(
		({ baseKey, raw, resource }) => {
			const key = `${baseKey}:resource:${encodeURIComponent(window.location.origin)}:${resource.kind}:${encodeURIComponent(resource.id)}`;
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

/**
 * Server mode keeps unsaved changes in this browser and the saved plan on
 * the server, so a test that needs both has to read both.
 */
export async function readTemporaryVersion(
	page: Page,
	resource?: FixtureResource,
) {
	return page.evaluate(
		({ prefix, resource }) => {
			const owner = `${resource.kind}:${encodeURIComponent(resource.id)}`;
			const key = `${prefix}:resource:${encodeURIComponent(window.location.origin)}:${owner}`;
			const raw = window.localStorage.getItem(key);
			return raw ? JSON.parse(raw).draft : null;
		},
		{
			prefix: REMOTE_STORAGE_KEY,
			resource: resource ?? (await fixtureResource(page)),
		},
	);
}

export async function readSavedServerPlan() {
	const api = await request.newContext();
	try {
		const response = await api.get(`${FIXTURE_API}/v1/financial-model`);
		if (!response.ok())
			throw new Error(`model read failed: ${response.status()}`);
		const body = await response.json();
		type movement = {
			id: string;
			name: string;
			amount: { config: { expression?: string } };
		};
		return {
			postings: body.document.postings as movement[],
			recurrenceRules: (body.document.recurrenceRules ?? []) as movement[],
		};
	} finally {
		await api.dispose();
	}
}
