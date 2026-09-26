import { defineConfig, devices } from "@playwright/test";

const production = process.env.TEST_PRODUCTION === "1";
const baseURL = production ? "http://127.0.0.1:4178" : "http://127.0.0.1:5178";

// Browser tests run against the real Go engine over real HTTP. The backend is
// the fixtureapi harness seeded from the canonical CSV model, on its own port
// so a developer's running backend is never attached to or mutated.
const apiURL = "http://127.0.0.1:8799";
const apiOrigin = process.env.FIXTURE_API_ORIGIN ?? apiURL;

export default defineConfig({
	testDir: "./tests",
	fullyParallel: true,
	retries: 0,
	// One worker: the suite shares a single seeded server, and resetFixture
	// restores shared state between tests. Parallel workers reset each other's
	// baseline mid-test.
	workers: 1,
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
	webServer: [
		{
			command: "go -C backend run ./cmd/fixtureapi",
			cwd: "..",
			env: {
				// The backend uses the pure-Go SQLite driver, matching
				// backend/scripts/verify.sh.
				CGO_ENABLED: "0",
				PORT: "8799",
				NET_WORTH_ESTIMATOR_DB: "/tmp/waypoint-browser-fixture.db",
				// `go -C backend` runs the binary with backend/ as its working
				// directory, so seed paths are relative to the repository root.
				// A purpose-built fixture keeps assertions stable and keeps a
				// real household's details out of the suite.
				NET_WORTH_ESTIMATOR_MODEL_PATH: "../frontend/tests/fixtures/model",
				NET_WORTH_ESTIMATOR_INCOME_PATH: "../frontend/tests/fixtures/income",
			},
			url: `${apiOrigin}/healthz`,
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
			stdout: "pipe",
		},
		{
			command: production ? "npm run preview" : "npm run dev",
			env: { NET_WORTH_ESTIMATOR_BACKEND: apiOrigin },
			url: baseURL,
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
		},
	],
});
