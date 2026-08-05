import { describe, expect, it } from "vitest";
import { createBaseDocument } from "../__fixtures__";
import { simulationDocument } from "../runtime/computationIdentity";

describe("simulationDocument", () => {
	it("includes checkpoint corrections in projection identity", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-31", AccountId: "checking", Balance: 500 },
			],
		});
		const changedCheckpointDocument = {
			...document,
			checkpoints: [{ ...document.checkpoints[0]!, Balance: 900 }],
		};

		expect(simulationDocument(changedCheckpointDocument)).not.toEqual(
			simulationDocument(document),
		);
		expect(simulationDocument(document).checkpoints).toEqual(
			document.checkpoints,
		);
	});
});
