import { defineConfig } from "orval";

// Transport contract per operation: user requests verify resource identity
// and cancel on scope change; identity requests precede verification;
// streams return the live resource-guarded Response; logout returns a
// Response so local state clears first. New identity operations or streams
// need a backend OpenAPI contract plus an override below, then a call from a
// query or mutation.
export default defineConfig({
	waypoint: {
		input: "./openapi.snapshot.json",
		output: {
			target: "./src/api/generated/endpoints.ts",
			schemas: "./src/api/generated/model",
			client: "fetch",
			httpClient: "fetch",
			baseUrl: "",
			override: {
				operations: {
					"get-receipt-image": {
						mutator: {
							path: "./src/api/waypoint-fetch.ts",
							name: "waypointBlobFetch",
						},
					},
					...Object.fromEntries(
						[
							"get-auth-session",
							"get-account-profile",
							"update-account-profile",
							"change-account-password",
							"list-account-sessions",
							"revoke-account-session",
						].map((operation) => [
							operation,
							{
								mutator: {
									path: "./src/api/waypoint-fetch.ts",
									name: "waypointAuthFetch",
								},
							},
						]),
					),
					logout: {
						mutator: {
							path: "./src/api/waypoint-fetch.ts",
							name: "waypointLogoutFetch",
							inferred: true,
						},
					},
					"project-stochastic": {
						mutator: {
							path: "./src/api/waypoint-fetch.ts",
							name: "waypointStreamFetch",
							inferred: true,
						},
					},
				},
				// The mutator throws on error statuses, so type every endpoint
				// as its success variant instead of a success/error union.
				fetch: { forceSuccessResponse: true },
				mutator: {
					path: "./src/api/waypoint-fetch.ts",
					name: "waypointFetch",
				},
			},
		},
	},
});
