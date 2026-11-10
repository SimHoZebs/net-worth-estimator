import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// One deadline controls commands, HTTP readiness, and browser cancellation.
// Teardown gets a separate bounded runtime after the work deadline expires.
export function createRuntime(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("E2E deadline exceeded")), milliseconds);
  const { signal } = controller;
  return {
    signal,
    dispose: () => clearTimeout(timer),
    async command(cmd, argv, { env = {}, timeout = 120_000, log = null } = {}) {
      signal.throwIfAborted();
      const child = spawn(cmd, argv, {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"], signal, timeout, killSignal: "SIGKILL",
      });
      let output = "";
      const collect = (chunk) => { output = (output + chunk).slice(-4_000_000); };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      try {
        const [code] = await once(child, "close");
        signal.throwIfAborted();
        if (code !== 0) throw new Error(`${cmd} ${argv.join(" ")} exited ${code}\n${output.slice(-4000)}`);
        return output;
      } catch (error) {
        // Abort emits error before close; wait until the process has exited.
        if (child.exitCode === null && child.signalCode === null) await once(child, "close");
        if (signal.aborted) throw signal.reason;
        throw error;
      } finally {
        if (log) await writeFile(log, output, { mode: 0o600 });
      }
    },
    async waitFor(url, { timeout = 90_000, label = url } = {}) {
      const polling = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
      let last = "";
      while (!polling.aborted) {
        try {
          const response = await fetch(url, {
            signal: AbortSignal.any([polling, AbortSignal.timeout(5000)]),
          });
          await response.body?.cancel();
          if (response.ok) return;
          last = `HTTP ${response.status}`;
        } catch (error) {
          last = error.message;
        }
        await delay(1000, undefined, { signal: polling }).catch(() => {});
      }
      signal.throwIfAborted();
      throw new Error(`timed out waiting for ${label}: ${last}`);
    },
  };
}
