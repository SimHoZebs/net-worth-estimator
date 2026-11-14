import { randomInt } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defineConfig,
	devices,
	type ReporterDescription,
} from "@playwright/test";

const production = process.env.TEST_PRODUCTION === "1";

// Every run gets its own ports. Several agents may run this suite at once, so
// no fixed port is safe, and the canonical dev stack keeps its own.
const port = (name: string) =>
	Number(process.env[name] ?? randomInt(20_000, 60_000));
const frontendPort = port("TEST_FRONTEND_PORT");
const apiPort = port("TEST_API_PORT");
// tests/integration/fixture.ts reads the same variables in the worker processes, which
// inherit this process environment.
process.env.TEST_FRONTEND_PORT = String(frontendPort);
process.env.TEST_API_PORT = String(apiPort);

const baseURL = `http://127.0.0.1:${frontendPort}`;

// A fresh database per run. Reusing a port-named file breaks the suite as soon
// as the schema changes, and two agents would share one file. The directory is
// removed when Playwright exits; the runner prunes leftovers from crashes.
const temporaryRoot =
	process.env.TMPDIR ??
	(existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir());
const runDirectory = mkdtempSync(join(temporaryRoot, "waypoint-browser-"));
const databasePath = join(runDirectory, "app.db");
process.on("exit", () => {
	rmSync(runDirectory, { recursive: true, force: true });
});

// The integration tests run against the real Go engine over real HTTP. The backend
// is the fixtureapi harness seeded from a fixture pack on its own
// ports, so a developer's running backend is never attached to or mutated.
const apiOrigin =
	process.env.FIXTURE_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`;

// The runner sets both paths per shard. A bare `playwright test` keeps the
// list reporter only, so local iteration stays quiet.
const blobDirectory = process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR;
const jsonOutput = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
const reporters: ReporterDescription[] = [["list"]];
if (blobDirectory) reporters.push(["blob", { outputDir: blobDirectory }]);
if (jsonOutput) reporters.push(["json", { outputFile: jsonOutput }]);

console.log(
	`integration tests: ui=${baseURL} api=${apiOrigin} db=${databasePath}`,
);

export default defineConfig({
	testDir: "./tests/integration",
	fullyParallel: true,
	retries: 0,
	// One worker per server: the suite shares a single seeded server, and
	// resetFixture restores shared state between tests. Parallel workers reset
	// each other's baseline mid-test. Shard across processes in the runner.
	workers: 1,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	reporter: reporters,
	use: {
		baseURL,
		// Fix the browser environment so currency, dates, and sort order never
		// depend on the host that runs the suite.
		locale: "en-US",
		timezoneId: "America/Los_Angeles",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		// Reduced motion makes the modal/drawer enter animations resolve
		// instantly, so axe and layout assertions never sample a mid-fade
		// frame (which reads as a contrast failure). The app honors this
		// via useReducedMotion; end states are unchanged.
		reducedMotion: "reduce",
	},
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
			command: "go -C backend run ./cmd/testing/fixtureapi",
			cwd: "..",
			env: {
				// The backend uses the pure-Go SQLite driver, matching
				// backend/scripts/verify.sh.
				CGO_ENABLED: "0",
				PORT: String(apiPort),
				NET_WORTH_ESTIMATOR_DB: databasePath,
				// INTEGRATION_PACK seeds the harness from an integration
				// fixture pack, so the matrix runner can drive these specs
				// against any edge dataset. Empty selects the baseline pack;
				// see docs/integration-edge-gates.md. INTEGRATION_BULK adds
				// tagged synthetic accounts on top of that baseline.
				INTEGRATION_PACK: process.env.INTEGRATION_PACK ?? "",
				INTEGRATION_BULK: process.env.INTEGRATION_BULK ?? "",
			},
			url: `${apiOrigin}/healthz`,
			reuseExistingServer: false,
			timeout: 180_000,
			stdout: "pipe",
		},
		{
			// bunx resolves the workspace binaries from this directory. Flags
			// pass straight to vite; npm needed the extra `--` separator.
			// --host mirrors the dev/preview scripts: without it vite binds
			// localhost only and 127.0.0.1 refuses connections.
			command: `bunx --no-install vite ${production ? "preview" : "dev"} --port ${frontendPort} --strictPort --host 0.0.0.0`,
			env: { NET_WORTH_ESTIMATOR_BACKEND: apiOrigin },
			url: baseURL,
			reuseExistingServer: false,
			timeout: 60_000,
		},
	],
});
