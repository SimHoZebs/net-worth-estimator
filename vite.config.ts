import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const backendOrigin =
		env.NET_WORTH_ESTIMATOR_BACKEND ?? "http://localhost:8787";
	return {
		plugins: [react(), tailwindcss()],
		server: {
			proxy: {
				"/v1": {
					target: backendOrigin,
					changeOrigin: true,
					configure(proxy) {
						proxy.on("proxyReq", (proxyRequest) => {
							// The browser request is same-origin with Vite; do not make the
							// backend interpret the development proxy hop as cross-origin.
							proxyRequest.removeHeader("origin");
						});
					},
				},
			},
		},
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
