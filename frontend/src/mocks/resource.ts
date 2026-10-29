import {
	acceptAccountScope,
	canonicalApiBaseUrl,
	suspendAccountScope,
} from "../auth/resourceScope.ts";

export function acceptTestResource() {
	return acceptAccountScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "accounts/test",
				kind: "private",
				permissions: ["account:read", "account:write", "account:project"],
			},
			subject: "test-owner",
		},
		suspendAccountScope(),
	);
}

/** Parameterized private owner for tests that rotate the account identity. */
export function acceptOwnerResource(id: string) {
	return acceptAccountScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: { id, kind: "private", permissions: ["account:read"] },
			subject: id,
		},
		suspendAccountScope(),
	);
}
