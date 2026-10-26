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
