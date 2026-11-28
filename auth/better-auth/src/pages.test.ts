import { expect, test } from "bun:test";
import { page } from "./pages";

test("auth feedback stays mounted while empty and announces server errors assertively", () => {
  expect(page("/sign-in", "")).toContain(
    '<p id="feedback" role="status" aria-live="polite" aria-atomic="true" data-tone="success"></p>',
  );
  expect(page("/sign-in", "", "Invalid <credentials>")).toContain(
    '<p id="feedback" role="alert" aria-live="assertive" aria-atomic="true" data-tone="error">Error: Invalid &lt;credentials&gt;</p>',
  );
});
