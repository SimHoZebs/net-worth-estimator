import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";

export function acceptTestResource() {
	return acceptResourceScope(
		{
			apiBaseUrl: "http://localhost",
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
