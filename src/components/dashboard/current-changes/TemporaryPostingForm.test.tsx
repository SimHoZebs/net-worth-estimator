// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { TemporaryPostingForm } from "./TemporaryPostingForm";

afterEach(cleanup);

describe("TemporaryPostingForm", () => {
	it("uses user-facing amount calculation terminology", () => {
		render(
			<TemporaryPostingForm
				postings={[]}
				document={createBaseDocument()}
				onAdd={() => {}}
				onRemove={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
		expect(screen.getByText("Amount calculation")).not.toBeNull();
		expect(screen.queryByText("Arithmetic")).toBeNull();
	});
});
