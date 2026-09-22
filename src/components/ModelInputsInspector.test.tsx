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
	it("opens on accounts", () => {
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
		expect(screen.getByText("Your accounts")).not.toBeNull();
	});

	it("keeps a single section selection across manage mode", () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Manage" }));
		expect(
			screen
				.getByRole("button", { name: /Activity/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("columnheader", { name: "Amount calculation" }),
		).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(
			screen
				.getByRole("button", { name: /Activity/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});
});
