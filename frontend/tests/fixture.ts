import { request } from "@playwright/test";

// The fixtureapi harness owns the recorded baseline. Resetting before each
// test keeps server state from leaking between tests that save.
export const FIXTURE_API =
	process.env.FIXTURE_API_ORIGIN ??
	`http://127.0.0.1:${process.env.TEST_API_PORT ?? 8799}`;

export async function resetFixture(
	options: {
		readOnly?: boolean;
		pinnedEvaluationIds?: string[];
		bankTransactions?: {
			id: string;
			description: string;
			amount: string;
			posted: number;
			pending?: boolean;
		}[];
	} = {},
): Promise<void> {
	const api = await request.newContext();
	try {
		const response = await api.post(`${FIXTURE_API}/__fixture/reset`, {
			data: {
				readOnly: options.readOnly ?? false,
				bankTransactions: options.bankTransactions,
			},
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
		};
		type account = { id: string; minBalance: number };
		return {
			accounts: body.model.accounts as account[],
			postings: body.model.postings as transaction[],
			recurrenceRules: (body.model.recurrenceRules ?? []) as transaction[],
		};
	} finally {
		await api.dispose();
	}
}
