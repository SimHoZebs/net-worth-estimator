// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { useStore } from "@/store";
import { RuntimeFixtureProviders } from "@/test/runtimeFixtures";
import { ModelInputsInspector } from "./ModelInputsInspector";

afterEach(() => {
	cleanup();
	useStore.setState({
		isEditing: false,
		isDirty: false,
		workingDocument: null,
	});
});

describe("ModelInputsInspector", () => {
	it("opens on accounts with quick actions", () => {
		const document = createBaseDocument();
		render(
			<RuntimeFixtureProviders
				model={{ document, effectiveDocument: document }}
			>
				<ModelInputsInspector />
			</RuntimeFixtureProviders>,
		);

		expect(
			screen
				.getByRole("button", { name: /Accounts/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByText("Total balance")).not.toBeNull();
		expect(screen.getByRole("button", { name: /Pay/ })).not.toBeNull();
	});

	it("opens a money movement detail from the scheduled feed", () => {
		const document = createBaseDocument({
			postings: [
				makePosting({
					id: "salary",
					label: "Salary",
					sourceAccountId: null,
					destinations: ["checking"],
					frequency: "monthly",
					startDate: "2026-02-01",
				}),
			],
		});
		render(
			<RuntimeFixtureProviders
				model={{ document, effectiveDocument: document }}
			>
				<ModelInputsInspector />
			</RuntimeFixtureProviders>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Scheduled/ }));
		fireEvent.click(screen.getByRole("button", { name: /Salary/ }));
		expect(screen.getByRole("heading", { name: "Salary" })).not.toBeNull();
		expect(screen.getByRole("button", { name: "Exclude" })).not.toBeNull();
	});

	it("keeps the selected section when opening activity", () => {
		const document = createBaseDocument({
			postings: [
				makePosting({
					id: "history",
					frequency: "once",
					startDate: "2026-01-31",
				}),
			],
		});
		render(
			<RuntimeFixtureProviders
				model={{ document, effectiveDocument: document }}
			>
				<ModelInputsInspector />
			</RuntimeFixtureProviders>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
		expect(
			screen
				.getByRole("button", { name: /Activity/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});
});
