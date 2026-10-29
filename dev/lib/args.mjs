// Single option table for every dev entry point. The dispatcher and each
// purpose script parse the same flags so direct invocation
// (`node dev/setup.mjs ...`) and router invocation (`scripts/dev setup ...`)
// accept and reject identically; each purpose module owns its semantic checks.
export const devOptions = {
  from: { type: "string" },
  plan: { type: "string" },
  account: { type: "string" },
  "source-plan": { type: "string" },
  "source-account": { type: "string" },
  slot: { type: "string" },
  "app-port": { type: "string" },
  "casdoor-port": { type: "string" },
  "backend-port": { type: "string" },
  tailnet: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};
