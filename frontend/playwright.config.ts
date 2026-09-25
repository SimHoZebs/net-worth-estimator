import { defineConfig, devices } from "@playwright/test";

const production = process.env.TEST_PRODUCTION === "1";
const baseURL = production ? "http://127.0.0.1:4178" : "http://127.0.0.1:5178";

export default defineConfig({
	testDir: "./tests",
	fullyParallel: true,
	retries: 0,
	workers: 2,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	reporter: "list",
	use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1440, height: 1080 },
			},
		},
	],
	webServer: {
		command: production
			? "VITE_WAYPOINT_MODE=fixture npm run preview"
			: "VITE_WAYPOINT_MODE=fixture npm run dev",
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
