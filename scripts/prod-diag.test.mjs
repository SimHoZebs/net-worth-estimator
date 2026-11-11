import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	assertReadOnly,
	buildRemoteCommand,
	formatReport,
	linkQuery,
	accountQuery,
	resolveUser,
	ruleQuery,
	settingsQuery,
	shQuote,
	sqlQuote,
} from "./prod-diag.mjs";

const script = fileURLToPath(new URL("./prod-diag.mjs", import.meta.url));

const FAKE_NORTHFLANK = `#!/bin/sh
cmd=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--cmd" ]; then cmd="$arg"; fi
  prev="$arg"
done
case "$cmd" in
  *"FROM users"*) echo '[{"id":"user:aaa111"},{"id":"user:bbb222"}]' ;;
  *"FROM accounts"*)
    case "$cmd" in *"id, name,"*) echo '[{"id":"a1","name":"Checking","kind":"cash","enabled":1}]';; *) echo '[{"id":"a1","kind":"cash","enabled":1}]';; esac ;;
  *"FROM recurrence_rules"*)
    case "$cmd" in *"id, name, source"*) echo '[{"id":"r1","name":"Pay","source_account_id":null,"destinations":"[\\"a1\\"]","start_date":"2026-11-30","end_date":null,"enabled":1,"frequency":"monthly"}]';; *) echo '[{"id":"r1","source_account_id":null,"destinations":"[\\"a1\\"]","start_date":"2026-11-30","end_date":null,"enabled":1,"frequency":"monthly"}]';; esac ;;
  *"FROM account_links"*)
    case "$cmd" in *"bridge_name"*) echo '[{"bridge_account_id":"b1","model_account_id":"a1","bridge_name":"Checking 1234","institution":"Bank","currency":"USD","origin":"auto","last_seen_at":"2026-11-10"}]';; *) echo '[{"model_account_id":"a1","origin":"auto"}]';; esac ;;
  *"FROM safe_spending_settings"*) echo '[{"settings_json":"{\\"reserve\\":725}"}]' ;;
  *) echo '[]' ;;
esac
`;

function run(args, env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [script, ...args], {
			env: { ...process.env, ...env },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stdout, stderr }));
	});
}

async function withFakeNorthflank(t) {
	const directory = await mkdtemp(join(tmpdir(), "waypoint-diag-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, "northflank");
	await writeFile(path, FAKE_NORTHFLANK);
	await chmod(path, 0o700);
	return { PATH: directory + delimiter + process.env.PATH };
}

test("diag prints usage on --help", async () => {
	const { code, stdout } = await run(["--help"]);
	assert.equal(code, 0);
	assert.match(stdout, /Usage: scripts\/prod-diag\.mjs/);
	assert.match(stdout, /--list-users/);
});

test("diag rejects unknown options", async () => {
	const { code, stderr } = await run(["--nope"]);
	assert.equal(code, 2);
	assert.match(stderr, /Unknown option/);
});

test("diag requires a user or --list-users", async () => {
	const { code, stderr } = await run([]);
	assert.equal(code, 2);
	assert.match(stderr, /--user/);
});

test("sqlQuote escapes single quotes", () => {
	assert.equal(sqlQuote("user:ab'cd"), "'user:ab''cd'");
});

test("shQuote escapes single quotes for POSIX shells", () => {
	assert.equal(shQuote("a'b"), `'a'\\''b'`);
});

test("remote commands stay read-only over a ro URI", () => {
	const command = buildRemoteCommand("/data/waypoint.db", "SELECT id FROM users ORDER BY id");
	assert.match(command, /mode=ro/);
	assert.match(command, /sqlite3 -json/);
	assert.throws(() => assertReadOnly("DELETE FROM users"), /non-SELECT/);
	assert.throws(() => assertReadOnly("SELECT * FROM users; DROP TABLE users"), /non-SELECT/);
});

test("generated queries never touch balances, amounts, or history tables", () => {
	const user = "user:abc";
	for (const query of [
		accountQuery(user, false),
		accountQuery(user, true),
		ruleQuery(user, false),
		ruleQuery(user, true),
		linkQuery(user, false),
		linkQuery(user, true),
		settingsQuery(user),
	]) {
		buildRemoteCommand("/data/waypoint.db", query);
		assert.doesNotMatch(query.toLowerCase(), /balance|amount|checkpoint|transaction|receipt/);
	}
});

test("resolveUser needs a unique fragment", () => {
	assert.equal(resolveUser(["user:aaa", "user:bbb"], "aaa"), "user:aaa");
	assert.throws(() => resolveUser(["user:aaa"], "zzz"), /No user matches/);
	assert.throws(() => resolveUser(["user:aaa", "user:aab"], "a"), /2 users match/);
});

test("formatReport renders the redacted sections as JSON", () => {
	const text = formatReport({
		user: "user:aaa",
		accounts: [{ id: "a1", kind: "cash", enabled: 1 }],
		rules: [],
		links: [],
		settings: [],
	});
	assert.deepEqual(JSON.parse(text), {
		user: "user:aaa",
		accounts: [{ id: "a1", kind: "cash", enabled: 1 }],
		rules: [],
		links: [],
		settings: [],
	});
});

test("diag lists users without touching workspace rows", async (t) => {
	const env = await withFakeNorthflank(t);
	const { code, stdout } = await run(["--list-users"], env);
	assert.equal(code, 0);
	assert.equal(stdout, "user:aaa111\nuser:bbb222\n");
});

test("diag redacts names and bridge details by default", async (t) => {
	const env = await withFakeNorthflank(t);
	const { code, stdout } = await run(["--user", "aaa"], env);
	assert.equal(code, 0);
	const report = JSON.parse(stdout);
	assert.equal(report.user, "user:aaa111");
	assert.deepEqual(Object.keys(report.accounts[0]).sort(), ["enabled", "id", "kind"]);
	assert.deepEqual(Object.keys(report.rules[0]).sort(), [
		"destinations",
		"enabled",
		"end_date",
		"frequency",
		"id",
		"source_account_id",
		"start_date",
	]);
	assert.deepEqual(Object.keys(report.links[0]).sort(), ["model_account_id", "origin"]);
	assert.doesNotMatch(stdout, /Checking/);
});

test("diag includes names only with --include-names", async (t) => {
	const env = await withFakeNorthflank(t);
	const { code, stdout } = await run(["--user", "aaa", "--include-names"], env);
	assert.equal(code, 0);
	const report = JSON.parse(stdout);
	assert.equal(report.accounts[0].name, "Checking");
	assert.equal(report.rules[0].name, "Pay");
	assert.equal(report.links[0].bridge_name, "Checking 1234");
});

test("diag fails closed on ambiguous fragments", async (t) => {
	const env = await withFakeNorthflank(t);
	const { code, stderr } = await run(["--user", "user:"], env);
	assert.equal(code, 1);
	assert.match(stderr, /2 users match/);
});
