import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { csvFilePlugin } from "./plugins/csvFilePlugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), csvFilePlugin({ csvPath: "./public/scenario" })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
