// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import {
	type ModelRuntime,
	ModelRuntimeProvider,
} from "@/runtime/modelRuntime";
import { AnalysisPage } from "./AnalysisPage";

afterEach(() => {
	document.body.innerHTML = "";
});

function analysisDocument() {
	return createBaseDocument({
		postings: [
			makePosting({
				id: "amazon-april",
				label: "Amazon Development Payroll 2026-04-30",
				destinations: ["checking"],
				arithmetic: "41330.61",
				frequency: "once",
				startDate: "2026-04-30",
			}),
			makePosting({
				id: "amazon-june",
				label: "Amazon Development Payroll 2026-06-30",
				destinations: ["checking"],
				arithmetic: "7455.96",
				frequency: "once",
				startDate: "2026-06-30",
			}),
			makePosting({
				id: "amazon-july",
				label: "Amazon Development Payroll 2026-07-31",
				destinations: ["checking"],
				arithmetic: "7579.38",
				frequency: "once",
				startDate: "2026-07-31",
			}),
		],
	});
}

function renderPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const documentModel = analysisDocument();
	const runtime: ModelRuntime = {
		source: {
			label: "Test model",
			description: "Test model",
			sourceType: "test",
			saveLabel: null,
			resetLabel: null,
		},
		document: documentModel,
		incomeData: null,
		effectiveDocument: null,
		issues: [],
		validationIsValid: true,
		loadError: null,
		sourceActionError: null,
		isLoading: false,
		isSourceUpdating: false,
		dataUpdatedAt: 0,
		projectionStartDate: "2026-08-01",
		isSaving: false,
		isResetting: false,
		reload: () => {},
		save: () => {},
		applyTemplate: () => {},
	};
	return render(
		<ModelRuntimeProvider value={runtime}>
			<QueryClientProvider client={queryClient}>
				<AnalysisPage />
			</QueryClientProvider>
		</ModelRuntimeProvider>,
	);
}

describe("AnalysisPage", () => {
	it("analyzes one-time external inflow postings without an import control", async () => {
		renderPage();
		expect(screen.queryByLabelText("Import transaction CSV")).toBeNull();
		expect(await screen.findByText("Observed net pay")).not.toBeNull();
		expect((await screen.findAllByText("$7,518")).length).toBeGreaterThan(0);
		expect(screen.getByText("provisional")).not.toBeNull();
		expect(screen.getByText("3")).not.toBeNull();
	});

	it("does not treat recurring model rules as observed postings", async () => {
		renderPage();
		expect(await screen.findByText("Observed postings")).not.toBeNull();
		expect(screen.getByText("3")).not.toBeNull();
	});
});
