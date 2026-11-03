#!/usr/bin/env node
// Run the browser integration suite in parallel shards on isolated random ports.
//
// Several agents may run this suite at the same time on one machine, so no
// fixed port is safe. Each shard asks the OS for a free port, and a shard that
// still loses a race gets new ports and retries.
import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { createServer } from "node:net";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const resultsRoot = join(frontendDirectory, "test-results");
// Unique per invocation: concurrent runs in one worktree must never share
// trace and screenshot blobs, not even for single-shard runs.
const runTag = `run-${process.pid}`;
const runRoot = join("test-results", runTag);
const blobRoot = join(runRoot, "blobs");
const htmlRoot = join(runRoot, "html");
const conflictPattern =
	/EADDRINUSE|address already in use|Port \d+ is already in use/;
const attempts = 3;
const staleRunAge = 24 * 60 * 60 * 1000;

function parseArguments(argv) {
	let shards = Number(process.env.TEST_BROWSER_SHARDS ?? 0);
	const passthrough = [];
	for (const argument of argv) {
		const match = /^--shards=(\d+)$/.exec(argument);
		if (match) {
			shards = Number(match[1]);
			continue;
		}
		passthrough.push(argument);
	}
	if (!Number.isInteger(shards) || shards < 1) {
		shards = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
	}
	// A targeted file list or an explicit Playwright shard already limits work;
	// splitting it again starts empty shards and wastes servers.
	if (passthrough.some((argument) => argument.startsWith("--shard")))
		shards = 1;
	else if (passthrough.some((argument) => !argument.startsWith("-")))
		shards = 1;
	return { shards, passthrough };
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => resolve(address.port));
		});
	});
}

function pruneDirectory(root, prefix) {
	let entries = [];
	try {
		entries = readdirSync(root);
	} catch {
		return;
	}
	const cutoff = Date.now() - staleRunAge;
	for (const entry of entries) {
		if (!entry.startsWith(prefix)) continue;
		const path = join(root, entry);
		try {
			if (statSync(path).mtimeMs < cutoff)
				rmSync(path, { recursive: true, force: true });
		} catch {
			// Another agent may clean the same directory; ignore it.
		}
	}
}

function pruneStaleRuns() {
	// Port-named databases from the previous scheme match the same prefix as
	// the current per-run directories; rmSync removes files as well.
	pruneDirectory(temporaryRoot, "waypoint-browser-");
	pruneDirectory(resultsRoot, "run-");
}

function forward(stream, prefix) {
	let buffer = "";
	stream.on("data", (chunk) => {
		buffer += chunk.toString();
		let index = buffer.indexOf("\n");
		while (index !== -1) {
			process.stdout.write(`${prefix}${buffer.slice(0, index + 1)}`);
			buffer = buffer.slice(index + 1);
			index = buffer.indexOf("\n");
		}
	});
	stream.on("end", () => {
		if (buffer) process.stdout.write(`${prefix}${buffer}\n`);
	});
}

function runShard({ index, shards, frontendPort, apiPort, passthrough }) {
	return new Promise((resolve) => {
		const label =
			shards === 1 ? "[integration]" : `[integration ${index}/${shards}]`;
		const outputDir = join(runRoot, `shard-${index}`);
		const argumentsList = [
			"--no-install",
			"playwright",
			"test",
			// Every invocation writes its own blobs. Processes sharing one
			// output directory race on trace files and fail healthy tests.
			`--output=${outputDir}`,
			...(shards > 1 ? [`--shard=${index}/${shards}`] : []),
			...passthrough,
		];
		if (process.env.FIXTURE_API_ORIGIN) {
			console.log(
				`[integration] ignoring FIXTURE_API_ORIGIN: shards must reset their own fixture backends`,
			);
		}
		const env = {
			...process.env,
			CI: "1",
			TEST_FRONTEND_PORT: String(frontendPort),
			TEST_API_PORT: String(apiPort),
			// Each shard writes its own blob and JSON. The blobs are collected
			// into one directory afterwards and merged into a single report.
			PLAYWRIGHT_BLOB_OUTPUT_DIR: join(outputDir, "blobs"),
			PLAYWRIGHT_JSON_OUTPUT_FILE: join(outputDir, "results.json"),
		};
		delete env.FIXTURE_API_ORIGIN;
		const child = spawn("bunx", argumentsList, {
			cwd: frontendDirectory,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let output = "";
		const collect = (chunk) => {
			output = (output + chunk.toString()).slice(-200_000);
		};
		forward(child.stdout, `${label} `);
		forward(child.stderr, `${label} `);
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);

		child.on("error", (error) => resolve({ code: 1, output: error.message }));
		child.on("exit", (code) => resolve({ code: code ?? 1, output }));
	});
}

async function runWithRetry(shard) {
	let last = { code: 1, output: "" };
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const [frontendPort, apiPort] = await Promise.all([freePort(), freePort()]);
		last = await runShard({ ...shard, frontendPort, apiPort });
		if (last.code === 0) return last;
		if (!conflictPattern.test(last.output)) return last;
		console.log(
			`[integration] port conflict, retrying with new ports (${attempt}/${attempts})`,
		);
	}
	return last;
}

// merge-reports reads one flat directory of blob archives, so the per-shard
// blobs are copied into the run's blob directory under unique names.
function collectBlobs(shards) {
	const target = join(frontendDirectory, blobRoot);
	mkdirSync(target, { recursive: true });
	for (let index = 1; index <= shards; index += 1) {
		const source = join(frontendDirectory, runRoot, `shard-${index}`, "blobs");
		if (!existsSync(source)) continue;
		for (const file of readdirSync(source)) {
			if (!file.endsWith(".zip")) continue;
			copyFileSync(join(source, file), join(target, `shard-${index}-${file}`));
		}
	}
}

// A merged report is the only way to read a trace after a shard has exited.
// A merge failure must not change the suite result, so it is reported only.
function mergeReports(shards) {
	collectBlobs(shards);
	const result = spawnSync(
		"bunx",
		[
			"--no-install",
			"playwright",
			"merge-reports",
			"--reporter=html",
			blobRoot,
		],
		{
			cwd: frontendDirectory,
			env: {
				...process.env,
				PLAYWRIGHT_HTML_OUTPUT_DIR: htmlRoot,
				PLAYWRIGHT_HTML_OPEN: "never",
			},
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		console.log(
			`[integration] could not merge reports: ${(result.stderr || result.stdout || "").trim()}`,
		);
		return;
	}
	console.log(`[integration] html report: ${htmlRoot}/index.html`);
	console.log(`[integration] json results: ${runRoot}/shard-N/results.json`);
}

function generateClient() {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", ["--filter", "./frontend", "api:generate"], {
			cwd: join(frontendDirectory, ".."),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`api:generate failed:\n${output}`));
		});
	});
}

async function main() {
	const { shards, passthrough } = parseArguments(process.argv.slice(2));
	pruneStaleRuns();
	// No pre-hooks: the runner refreshes the client before shards boot so
	// standalone runs never use a stale tree. Gate entries already generated
	// it up front; the refresh is cheap and keeps one code path.
	await generateClient();
	console.log(`[integration] outputs: test-results/${runTag}/`);

	const results = await Promise.all(
		Array.from({ length: shards }, (_, position) =>
			runWithRetry({
				index: position + 1,
				shards,
				passthrough,
			}),
		),
	);

	const failed = results.filter((result) => result.code !== 0).length;
	const passed = results.length - failed;
	mergeReports(shards);
	console.log(
		`[integration] ${passed} shard${passed === 1 ? "" : "s"} passed, ${failed} failed`,
	);
	process.exit(failed === 0 ? 0 : 1);
}

main();
