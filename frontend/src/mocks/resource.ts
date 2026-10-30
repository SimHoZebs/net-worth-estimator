import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";

// The guest is an ordinary provisioned user: its session carries a canonical
// `users/<64hex>` resource id and a provisioned subject exactly like a
// signed-in identity. Only `authenticated` differs (false for guests), and it
// drives login/account UX, never permissions or identity.
export const GUEST_USER_ID = `users/${"7".repeat(64)}`;
export const GUEST_USER_SUBJECT = "guest-user";

export const GUEST_USER_RESOURCE = {
	id: GUEST_USER_ID,
	permissions: ["user:read", "user:project"],
} as const;

export function acceptTestResource() {
	return acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/test",
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
			resource: { id, permissions: ["user:read"] },
			subject: id,
		},
		suspendUserScope(),
	);
}
