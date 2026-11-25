import test from "node:test";
import assert from "node:assert/strict";
import { main } from "./main.mjs";

test("Compose owns daily lifecycle commands; the helper only accepts setup and data operations", async () => {
  for (const command of ["up", "down", "status", "logs", undefined]) {
    await assert.rejects(() => main(command ? [command] : []), /Use docker compose/);
  }
  await assert.rejects(() => main(["setup", "--no-build"]), /Unknown option/);
  await assert.rejects(() => main(["setup", "--port", "8765"]), /applies only to check/);
  await assert.rejects(() => main(["refresh-db", "--tailnet"]), /only to setup/);
  await assert.rejects(() => main(["publish-sample", "extra"]), /Unexpected/);
  await assert.rejects(() => main(["grant", "subject", "editor"]), /Access is automatic/);
  await assert.rejects(() => main(["check"]), /--port N is required/);
  await assert.rejects(() => main(["check", "--port", "80"]), /1024 to 65535/);
});
