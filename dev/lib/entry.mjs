import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Shared CLI entry guard. `node --test dev/*.mjs` would otherwise execute
// every matched module as a program (the test runner sets NODE_TEST_CONTEXT
// in its workers; a real terminal never does). The correct suite glob is
// `node --test dev/*.test.mjs`.
export function runIfCli(importMetaUrl, argv, main) {
  if (process.env.NODE_TEST_CONTEXT !== undefined) return;
  if (argv[1] && importMetaUrl === pathToFileURL(resolve(argv[1])).href) {
    main(argv.slice(2)).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
