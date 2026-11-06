import { compile } from "@tailwindcss/node";
import { fileURLToPath } from "node:url";
import { page } from "./src/pages";

const output = new URL("./public/", import.meta.url);
const client = await Bun.build({
  entrypoints: [fileURLToPath(new URL("./src/client.ts", import.meta.url))],
  target: "browser",
  minify: true,
});
if (!client.success) throw new Error("Auth client build failed", { cause: client.logs });
await Bun.write(new URL("client.js", output), client.outputs[0]);
const source = await Bun.file(new URL("./src/auth.css", import.meta.url)).text();
const compiler = await compile(source, {
  base: fileURLToPath(new URL("./src/", import.meta.url)),
  onDependency() {},
});
const candidates = new Set<string>();
for (const path of ["/sign-in", "/sign-up", "/account", "/device"]) {
  for (const match of page(path, "").matchAll(/class="([^"]+)"/g))
    for (const name of match[1].split(/\s+/)) candidates.add(name);
}
await Bun.write(new URL("auth.css", output), compiler.build([...candidates]));
await Bun.write(
  new URL("manrope.woff2", output),
  Bun.file(
    new URL(
      "../../frontend/node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
      import.meta.url,
    ),
  ),
);
