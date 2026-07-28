// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { OverviewCard } from "./OverviewCard";

afterEach(cleanup);

describe("OverviewCard", () => {
	it("shows the committed FI success rule and test period", () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const plan = settings.evaluations.financialIndependence[0]!.config;
		const result = projectFinancialModelDocument(document, settings, {
			addedAccounts: [],
			addedPostings: [],
			disabledAccountIds: [],
			disabledPostingIds: [],
		});

		render(
			<OverviewCard
				result={result}
				instanceId="fi"
				plan={plan}
				blockerValue="No blocker"
				blockerDetail="No blocker"
			/>,
		);

		expect(
			screen.getByText("1-year test · preserve purchasing power"),
		).not.toBeNull();
		expect(
			screen.getByText(
				"All spending must be funded and selected assets must retain their inflation-adjusted starting value.",
			),
		).not.toBeNull();
	});
});
