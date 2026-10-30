import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.host_permissions || manifest.externally_connectable)
  throw new Error("Unexpected extension privilege expansion.");
for (const file of await readdir(resolve(root, "src")))
  if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", resolve(root, "src", file)]);
await mkdir(resolve(root, "dist"), { recursive: true });
for (const file of ["manifest.json", "panel.html", "panel.css", "src"])
  await cp(resolve(root, file), resolve(root, "dist", file), { recursive: true });
console.log("Load extension/dist as an unpacked extension in Chrome or Brave.");
