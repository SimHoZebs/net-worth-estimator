// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { CashFlowWaterfall } from "./CashFlowWaterfall";

afterEach(cleanup);

describe("CashFlowWaterfall", () => {
	it("excludes one-time balance adjustments from monthly cash flow", () => {
		const document = createBaseDocument();
		const historical = document.postings.find(
			(posting) => posting.frequency === "once",
		)!;
		const recurring = document.postings.find(
			(posting) => posting.frequency !== "once",
		)!;

		render(<CashFlowWaterfall document={document} />);

		expect(screen.queryByText(historical.label)).toBeNull();
		expect(screen.getByText(recurring.label)).not.toBeNull();
	});
});
