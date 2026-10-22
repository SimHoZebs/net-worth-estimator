import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { dialogActionsStyles } from "./dialogStyles.ts";
import { mergeStyles } from "./mergeStyles.ts";
import { Notice } from "./Notice.tsx";
import { noticeStyles } from "./noticeStyles.ts";

afterEach(cleanup);

it("preserves dialog action order and allows native props and layout overrides", () => {
	const view = render(
		<div
			data-testid="actions"
			className={mergeStyles(dialogActionsStyles, "justify-start mt-2")}
		>
			<button type="button">Cancel</button>
			<button type="submit" form="editor">
				Save
			</button>
		</div>,
	);
	const actions = view.getByTestId("actions");
	expect(actions.classList.contains("justify-end")).toBe(false);
	expect(actions.classList.contains("mt-6")).toBe(false);
	expect(
		view.getAllByRole("button").map((button) => button.textContent),
	).toEqual(["Cancel", "Save"]);
});

it("preserves explicit announcement semantics and exports notice variants", () => {
	const view = render(
		<Notice tone="danger" role="alert" className="p-5">
			Failed
		</Notice>,
	);
	const notice = view.getByRole("alert");
	expect(notice.classList.contains("p-4")).toBe(false);
	expect(notice.classList.contains("p-5")).toBe(true);
	expect(noticeStyles({ tone: "warning" })).toContain("bg-warning-bg");
});

it("provides note semantics for information and alert semantics for errors", () => {
	const view = render(
		<>
			<Notice>Information</Notice>
			<Notice tone="danger">Failed</Notice>
		</>,
	);
	expect(view.getByRole("note").textContent).toBe("Information");
	expect(view.getByRole("alert").textContent).toBe("Failed");
});
