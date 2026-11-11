#!/usr/bin/env node
// Read-only production workspace diagnostic over the Northflank API volume.
//
// Pulls one user's safe-spending-relevant shape (accounts, recurrence rules,
// bank-sync links, safe-spending settings) without touching production state:
// every query is a SELECT against a mode=ro SQLite URI, names and bank
// details stay redacted unless --include-names is passed, and balances,
// amounts, checkpoints, and transactions are never selected at all.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULTS = Object.freeze({
	project: "net-worth",
	service: "nwe-api",
	db: "/data/waypoint.db",
});

const WRITE_PATTERN =
	/\b(insert|update|delete|drop|alter|create|attach|detach|replace|vacuum|pragma)\b/i;

export function usage() {
	return [
		"Usage: scripts/prod-diag.mjs [--list-users] [--user FRAGMENT] [--include-names]",
		"         [--project NAME] [--service NAME] [--db /container/path.db]",
		"  --list-users   print opaque user ids only, then exit",
		"  --user FRAG    unique substring of a user id (required unless --list-users)",
		"  --include-names  also print account, rule, and bank-bridge names",
		"Defaults are redacted: no names, no bridge details, no balances, no amounts.",
		"Every query is a SELECT over a mode=ro SQLite URI; production is never written.",
	].join("\n");
}

export function parseArgs(argv) {
	const options = {
		listUsers: false,
		user: null,
		includeNames: false,
		project: DEFAULTS.project,
		service: DEFAULTS.service,
		db: DEFAULTS.db,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--list-users") options.listUsers = true;
		else if (argument === "--include-names") options.includeNames = true;
		else if (argument === "--user") {
			options.user = argv[index + 1];
			if (options.user === undefined) throw usageError("--user needs a value");
			index += 1;
		} else if (argument === "--project" || argument === "--service" || argument === "--db") {
			const value = argv[index + 1];
			if (value === undefined) throw usageError(`${argument} needs a value`);
			if (value === "" || value === "-") throw usageError(`${argument} must not be empty`);
			options[argument.slice(2)] = value;
			index += 1;
		} else if (argument === "--help" || argument === "-h") {
			options.help = true;
		} else {
			throw usageError(`Unknown option: ${argument}`);
		}
	}
	if (!options.listUsers && !options.help && !options.user) {
		throw usageError("Pass --user FRAGMENT or --list-users");
	}
	return options;
}

function usageError(message) {
	const error = new Error(message);
	error.code = 2;
	return error;
}

/** Quote a value as a SQL string literal. */
export function sqlQuote(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** Quote a value as a POSIX shell single-quoted word. */
export function shQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Reject anything but a lone SELECT so the read-only promise holds by construction. */
export function assertReadOnly(sql) {
	const cleaned = sql.trim().replace(/;+\s*$/, "");
	if (!/^select\b/i.test(cleaned) || WRITE_PATTERN.test(cleaned)) {
		throw new Error(`Refusing non-SELECT statement: ${sql.slice(0, 80)}`);
	}
	return cleaned;
}

/** Build the container-side sqlite3 invocation; the URI keeps SQLite itself read-only too. */
export function buildRemoteCommand(db, sql) {
	const statement = assertReadOnly(sql);
	return `sqlite3 -json ${shQuote(`file:${db}?mode=ro`)} ${shQuote(statement)}`;
}

export function resolveUser(users, fragment) {
	const matches = users.filter((id) => id.includes(fragment));
	if (matches.length === 0) throw new Error(`No user matches ${JSON.stringify(fragment)}`);
	if (matches.length > 1) {
		throw new Error(
			`${matches.length} users match ${JSON.stringify(fragment)}; use a longer fragment:\n${matches.join("\n")}`,
		);
	}
	return matches[0];
}

export function accountQuery(userId, includeNames) {
	const columns = includeNames ? "id, name, kind, enabled" : "id, kind, enabled";
	return `SELECT ${columns} FROM accounts WHERE user_id = ${sqlQuote(userId)} ORDER BY position`;
}

export function ruleQuery(userId, includeNames) {
	const columns = includeNames
		? "id, name, source_account_id, destinations, start_date, end_date, enabled, frequency"
		: "id, source_account_id, destinations, start_date, end_date, enabled, frequency";
	return `SELECT ${columns} FROM recurrence_rules WHERE user_id = ${sqlQuote(userId)} ORDER BY position`;
}

export function linkQuery(userId, includeNames) {
	const columns = includeNames
		? "bridge_account_id, model_account_id, bridge_name, institution, currency, origin, last_seen_at"
		: "model_account_id, origin";
	return `SELECT ${columns} FROM account_links WHERE user_id = ${sqlQuote(userId)} ORDER BY bridge_account_id`;
}

export function settingsQuery(userId) {
	return `SELECT settings_json FROM safe_spending_settings WHERE user_id = ${sqlQuote(userId)}`;
}

export function queryRemote({ project, service, db }, sql, run = spawnSync) {
	const status = run(
		"northflank",
		["exec", "service", "--project", project, "--service", service, "--quiet", "--shell-cmd", "sh -c", "--cmd", buildRemoteCommand(db, sql)],
		{ encoding: "utf8" },
	);
	if (status.error) throw status.error;
	if (status.status !== 0) {
		throw new Error(`northflank exec failed: ${(status.stderr || "").trim() || `exit ${status.status}`}`);
	}
	try {
		return JSON.parse(status.stdout || "[]");
	} catch {
		throw new Error(`Could not parse sqlite output: ${(status.stdout || "").slice(0, 200)}`);
	}
}

export function formatReport({ user, accounts, rules, links, settings }) {
	return (
		JSON.stringify({ user, accounts, rules, links, settings }, null, 2) + "\n"
	);
}

export function run(argv, runExec = queryRemote) {
	const options = parseArgs(argv);
	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return 0;
	}
	const remote = (sql) => runExec(options, sql);
	if (options.listUsers) {
		const rows = remote("SELECT id FROM users ORDER BY id");
		process.stdout.write(`${rows.map((row) => row.id).join("\n")}\n`);
		return 0;
	}
	const users = remote("SELECT id FROM users ORDER BY id").map((row) => row.id);
	const user = resolveUser(users, options.user);
	const accounts = remote(accountQuery(user, options.includeNames));
	const rules = remote(ruleQuery(user, options.includeNames));
	const links = remote(linkQuery(user, options.includeNames));
	const settings = remote(settingsQuery(user));
	process.stdout.write(formatReport({ user, accounts, rules, links, settings }));
	return 0;
}

function main() {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`prod-diag: ${error.message}\n`);
		process.exitCode = typeof error.code === "number" ? error.code : 1;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
