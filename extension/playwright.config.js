import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  workers: 1,
  timeout: 60000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
