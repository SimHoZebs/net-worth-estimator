import { defineConfig } from "orval";

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
