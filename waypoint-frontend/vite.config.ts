import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	publicDir: "public",
	server: {
		port: 5178,
		strictPort: true,
		allowedHosts: process.env.TRAFORO_URL
			? [new URL(process.env.TRAFORO_URL).hostname]
			: [],
		fs: { strict: true },
		proxy: {
			"/v1": {
				target: "http://127.0.0.1:8787",
			},
		},
	},
	preview: { port: 4178, strictPort: true },
});
