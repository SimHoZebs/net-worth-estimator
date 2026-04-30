import { describe, expect, it } from "vitest";
import { checkpointEntrySchema } from "./projection";

describe("checkpoint schema", () => {
  it("accepts valid checkpoint rows", () => {
    const parsed = checkpointEntrySchema.parse({
      Date: "2026-04-29",
      AccountId: "cash",
      Balance: "1250.5",
    });

    expect(parsed.Balance).toBe(1250.5);
  });

  it("rejects invalid checkpoint rows", () => {
    const result = checkpointEntrySchema.safeParse({
      Date: "not-a-date",
      AccountId: "",
      Balance: "abc",
    });

    expect(result.success).toBe(false);
  });
});
