import { type Page, request } from "@playwright/test";

// The fixtureapi harness owns the recorded baseline. Resetting before each
// test keeps server state from leaking between tests that save.
export const FIXTURE_API =
	process.env.FIXTURE_API_ORIGIN ?? "http://127.0.0.1:8799";

export const REMOTE_STORAGE_KEY = "waypoint.remote-workspace.v1";

export async function resetFixture(
	options: { readOnly?: boolean } = {},
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
	} finally {
		await api.dispose();
	}
}

/**
 * Server mode keeps the temporary version in this browser and the saved plan on
 * the server, so a test that needs both has to read both.
 */
export async function readTemporaryVersion(page: Page) {
	return page.evaluate((key) => {
		const raw = window.localStorage.getItem(key);
		return raw ? JSON.parse(raw).draft : null;
	}, REMOTE_STORAGE_KEY);
}

export async function readSavedServerPlan() {
	const api = await request.newContext();
	try {
		const response = await api.get(`${FIXTURE_API}/v1/financial-model`);
		if (!response.ok())
			throw new Error(`model read failed: ${response.status()}`);
		const body = await response.json();
		return {
			postings: body.document.postings as {
				id: string;
				amount: { config: { expression?: string } };
			}[],
		};
	} finally {
		await api.dispose();
	}
}
