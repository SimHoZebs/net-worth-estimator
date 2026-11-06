import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		// The router plugin must come before the React plugin: it generates
		// the route tree and splits route chunks.
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	publicDir: "public",
	build: {
		rollupOptions: {
			output: {
				// Rolldown accepts only the function form. Keep the framework,
				// query, validator, and error libraries in their own chunks so a
				// page that uses either one never pays for the other.
				manualChunks: (id: string) => {
					if (/node_modules\/react(-dom)?\//.test(id)) return "react";
					if (id.includes("node_modules/@tanstack/react-query/"))
						return "query";
					if (id.includes("node_modules/zod/")) return "zod";
					if (id.includes("node_modules/errore/")) return "errore";
				},
			},
		},
	},
	server: {
		port: 5178,
		strictPort: true,
		allowedHosts: process.env.TRAFORO_URL
			? [new URL(process.env.TRAFORO_URL).hostname]
			: [],
		fs: { strict: true },
		proxy: {
			"/v1": {
				target:
					process.env.NET_WORTH_ESTIMATOR_BACKEND ?? "http://127.0.0.1:8787",
			},
		},
	},
	preview: { port: 4178, strictPort: true },
});
