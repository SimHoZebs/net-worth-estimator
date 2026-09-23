#!/usr/bin/env node
// Screenshot helper: URL -> PNG via playwright-core (opt-in, not installed by default).
// Usage: node scripts/shots.mjs <url> [--out file.png] [--width N] [--height N] [--full-page] [--wait ms]
// Defaults: real-Chrome UA, 1280x800 viewport, networkidle wait.
const REAL_CHROME_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function usage() {
	console.log(`Usage: node scripts/shots.mjs <url> [options]

Options:
  --out <file>     output PNG path (default: shot-<host>.png)
  --width <n>      viewport width (default: 1280)
  --height <n>     viewport height (default: 800)
  --full-page      capture the full page, not just the viewport
  --wait <ms>      extra wait after load before capture (default: 0)
  -h, --help       show this help`);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
	usage();
	process.exit(0);
}

const url = args.find((a) => !a.startsWith("-"));
if (!url) {
	usage();
	process.exit(2);
}
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 || i + 1 >= args.length ? fallback : args[i + 1];
};
const out =
	opt("--out", `shot-${new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_")}.png`);
const width = Number(opt("--width", "1280"));
const height = Number(opt("--height", "800"));
const fullPage = args.includes("--full-page");
const wait = Number(opt("--wait", "0"));

let chromium;
try {
	({ chromium } = await import("playwright-core"));
} catch {
	console.error(
		"playwright-core is not installed. Install it first (needs a Chrome/Chromium binary too):\n" +
			"  npm i -D playwright-core   # then use a system Chrome, or: npx playwright install chromium",
	);
	process.exit(127);
}

let browser;
try {
	browser = await chromium.launch({ channel: "chrome" });
} catch {
	browser = await chromium.launch();
}
try {
	const page = await browser.newPage({
		viewport: { width, height },
		userAgent: REAL_CHROME_UA,
	});
	await page.goto(url, { waitUntil: "networkidle" });
	if (wait > 0) await page.waitForTimeout(wait);
	await page.screenshot({ path: out, fullPage });
	console.log(`saved ${out}`);
} finally {
	await browser.close();
}
