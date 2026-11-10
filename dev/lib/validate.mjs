import { slotFromOptions } from "../config.mjs";

// Shared scope guards for dev commands. Each command keeps its own
// command-specific messages inline; only the repeated mechanical checks
// live here so behavior and error text stay identical.
export function rejectPositionals(
  positionals,
  message = "Unexpected dev arguments. Use scripts/dev --help.",
) {
  if (positionals.length > 0) throw new Error(message);
}

export function checkSlot(values) {
  slotFromOptions(values);
}

export function rejectTailnet(values, message = "--tailnet applies only to setup") {
  if (values.tailnet) throw new Error(message);
}

export function rejectPortsAfterCreation(values) {
  if (
    values["app-port"] !== undefined ||
    values["auth-port"] !== undefined ||
    values["backend-port"] !== undefined
  ) {
    throw new Error("Ports are fixed at slot creation. Pick a new --slot name for new ports.");
  }
}

export function rejectPackExceptDemo(values) {
  if (values.pack !== undefined) throw new Error("--pack applies only to demo.");
}

export function rejectBulkClearExceptSeed(values) {
  if (values.bulk !== undefined || values.clear !== undefined)
    throw new Error("--bulk and --clear apply only to seed.");
}
