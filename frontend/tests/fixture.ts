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

export interface SharingSeedPosting {
	name: string;
	amount: string;
	day?: string;
	pending?: boolean;
}

export interface SharingSeed {
	groupId: string;
	owner: string;
	postings: Array<{ id: string; name: string }>;
}

/** Seed one group with granted postings for the fixture user to view. */
export async function seedSharingFixture(
	groupName: string,
	ownerDisplay: string,
	postings: SharingSeedPosting[],
): Promise<SharingSeed> {
	const api = await request.newContext();
	try {
		const response = await api.post(`${FIXTURE_API}/__fixture/sharing`, {
			data: { groupName, ownerDisplay, postings },
		});
		if (!response.ok())
			throw new Error(
				`sharing seed failed: ${response.status()} ${await response.text()}`,
			);
		return (await response.json()) as SharingSeed;
	} finally {
		await api.dispose();
	}
}

export interface InboxSeed {
	owner: string;
	postings: Array<{ id: string; name: string }>;
	revoked: Array<{ id: string; name: string }>;
}

/** Seed direct shares to the fixture user. Named postings in `revoked` are
 * taken back before the test starts, so they surface on the canceled tab. */
export async function seedInboxFixture(
	postings: SharingSeedPosting[],
	revoked: string[] = [],
): Promise<InboxSeed> {
	const api = await request.newContext();
	try {
		const response = await api.post(`${FIXTURE_API}/__fixture/inbox`, {
			data: { postings, revoked },
		});
		if (!response.ok())
			throw new Error(
				`inbox seed failed: ${response.status()} ${await response.text()}`,
			);
		return (await response.json()) as InboxSeed;
	} finally {
		await api.dispose();
	}
}
