import path from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

describe("WorkerProjectionEngine production build", () => {
	it("emits executable bundles for both worker entries", async () => {
		const result = await build({
			configFile: path.resolve(process.cwd(), "vite.config.ts"),
			build: { write: false },
		});
		const builds = Array.isArray(result) ? result : [result];
		const outputs = builds.flatMap((buildResult) =>
			"output" in buildResult ? buildResult.output : [],
		);
		const javascript = outputs
			.filter((output) => output.fileName.endsWith(".js"))
			.map((output) => ({
				fileName: output.fileName,
				content:
					output.type === "chunk"
						? output.code
						: typeof output.source === "string"
							? output.source
							: Buffer.from(output.source).toString("utf8"),
			}));

		expect(
			javascript.some(({ fileName }) =>
				/projectionWorker-[^/]+\.js$/.test(fileName),
			),
		).toBe(true);
		expect(
			javascript.some(({ fileName }) =>
				/stochasticWorker-[^/]+\.js$/.test(fileName),
			),
		).toBe(true);
		expect(javascript.map(({ content }) => content).join("\n")).not.toContain(
			"data:video/mp2t",
		);
	});
});
