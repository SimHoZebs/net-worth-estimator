import baseConfig from "./playwright.config.ts";

// Manual demo harness: same isolated fixture API and Vite servers as the
// browser suite, but a headed browser and no test timeout so a developer can
// inspect the seeded account until they stop the command.
export default {
	...baseConfig,
	testDir: "./tests/demo",
	timeout: 0,
	use: {
		...baseConfig.use,
		headless: process.env.DEMO_HEADLESS === "1",
	},
};
