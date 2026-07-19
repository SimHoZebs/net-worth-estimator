import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { csvFilePlugin } from "./plugins/csvFilePlugin";

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		csvFilePlugin({ csvPath: "./public/configs" }),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "node",
	},
});
