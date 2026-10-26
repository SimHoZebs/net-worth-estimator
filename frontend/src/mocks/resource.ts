import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	suspendResourceScope,
} from "../auth/resourceScope.ts";

export function acceptTestResource() {
	return acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "plans/test",
				kind: "private",
				permissions: ["plan:read", "plan:write", "plan:project"],
			},
			subject: "test-owner",
		},
		suspendResourceScope(),
	);
}

/** Parameterized private owner for tests that rotate the resource identity. */
export function acceptOwnerResource(id: string) {
	return acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: { id, kind: "private", permissions: ["plan:read"] },
			subject: id,
		},
		suspendResourceScope(),
	);
}
