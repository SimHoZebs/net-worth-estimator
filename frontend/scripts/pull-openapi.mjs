// Refresh the checked-in OpenAPI snapshot from a running backend, then
// regenerate with `npm run api:generate`. The snapshot keeps builds offline
// and diffs reviewable; the backend remains the source of truth.
// Uses WAYPOINT_API_URL rather than NET_WORTH_ESTIMATOR_BACKEND on purpose:
// pull needs the host-reachable backend debug port serving /openapi.json,
// while the established var may point at a proxy origin that routes /v1 only.
import { writeFileSync } from "node:fs";

const base =
	process.env.WAYPOINT_API_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8788";
const response = await fetch(`${base}/openapi.json`);
if (!response.ok)
	throw new Error(`GET ${base}/openapi.json failed: HTTP ${response.status}`);
const spec = await response.json();
if (
	typeof spec?.openapi !== "string" ||
	!spec.openapi.startsWith("3.") ||
	typeof spec?.paths !== "object"
)
	throw new Error(
		`Unexpected OpenAPI document (openapi: ${spec?.openapi}, keys: ${Object.keys(spec ?? {}).join(",")})`,
	);
writeFileSync(
	new URL("../openapi.snapshot.json", import.meta.url),
	`${JSON.stringify(spec, null, "\t")}\n`,
);
console.log(
	`Wrote openapi.snapshot.json (openapi ${spec.openapi}, info ${spec.info?.version}, ${Object.keys(spec.paths).length} paths) from ${base}`,
);
