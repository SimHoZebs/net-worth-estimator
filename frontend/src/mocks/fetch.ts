import { getUserScope } from "../auth/resourceScope.ts";

// Shared fetch-test response helper. Route-specific stubs stay in the test
// files; only JSON-body construction with the current scope assertion is
// common enough to share.

export function ok(body: unknown, status = 200) {
	const headers = new Headers({ "content-type": "application/json" });
	const resource = getUserScope().resource?.id;
	if (resource) headers.set("Waypoint-Resource", resource);
	return new Response(JSON.stringify(body), { status, headers });
}
