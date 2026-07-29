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
	it("opens on the current position", () => {
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
				.getByRole("button", { name: /Current position/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByText("Your accounts")).not.toBeNull();
	});

	it("keeps separate read and edit tab selections", () => {
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

		fireEvent.click(
			screen.getByRole("button", { name: /Transaction history/ }),
		);
		expect(
			screen
				.getByRole("button", { name: /Transaction history/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "Edit baseline" }));
		expect(
			screen
				.getByRole("button", { name: /Posting definitions/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("columnheader", { name: "Amount calculation" }),
		).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(
			screen
				.getByRole("button", { name: /Transaction history/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});
});
