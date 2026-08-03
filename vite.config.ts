import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { csvFilePlugin } from "./plugins/csvFilePlugin";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	return {
		plugins: [
			react(),
			tailwindcss(),
			csvFilePlugin({
				csvPath: env.NET_WORTH_ESTIMATOR_MODEL_PATH ?? "./public/configs",
				incomePath:
					env.NET_WORTH_ESTIMATOR_INCOME_PATH ?? "./public/data/income",
			}),
		],
		resolve: {
			alias: {
				"@": path.resolve(import.meta.dirname, "./src"),
			},
		},
		test: {
			environment: "node",
			setupFiles: ["./src/test/setup.ts"],
			testTimeout: 15_000,
		},
	};
});
