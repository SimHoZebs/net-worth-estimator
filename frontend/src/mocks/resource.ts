import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";

export function acceptTestResource() {
	return acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/test",
				kind: "private",
				permissions: ["user:read", "user:write", "user:project"],
			},
			subject: "test-owner",
		},
		suspendUserScope(),
	);
}

/** Parameterized private owner for tests that rotate the user identity. */
export function acceptOwnerResource(id: string) {
	return acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: { id, kind: "private", permissions: ["user:read"] },
			subject: id,
		},
		suspendUserScope(),
	);
}
