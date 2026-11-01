import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	test: {
		include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
		environment: "jsdom",
		// One worker per process, with files sharing that worker and its jsdom
		// environment. tests/setup.ts clears DOM and storage after every test.
		// Without this the suite re-imports the whole app for every file.
		isolate: false,
		setupFiles: ["./tests/setup.ts"],
	},
});
