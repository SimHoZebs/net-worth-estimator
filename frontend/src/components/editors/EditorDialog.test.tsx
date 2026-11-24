import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorDialog } from "./EditorDialog.tsx";

function renderEditor(
	overrides: Partial<Parameters<typeof EditorDialog>[0]> = {},
) {
	const onSubmit = vi.fn();
	const onClose = vi.fn();
	render(
		<EditorDialog
			title="Add transaction"
			onClose={onClose}
			dirty={false}
			busy={false}
			error={null}
			submitLabel="Add transaction"
			onSubmit={onSubmit}
			{...overrides}
		>
			<label>
				Name
				<input />
			</label>
		</EditorDialog>,
	);
	const content = document.querySelector<HTMLElement>(
		'[data-slot="dialog-content"]',
	);
	if (!content) throw new Error("dialog content did not render");
	const body = content.querySelector<HTMLElement>('[data-slot="dialog-body"]');
	const footer = content.querySelector<HTMLElement>(
		'[data-slot="dialog-footer"]',
	);
	if (!body || !footer) throw new Error("dialog body/footer did not render");
	return { content, body, footer, onSubmit, onClose };
}

describe("editor dialog footer placement", () => {
	it("keeps the footer a sibling of the scrollable body", () => {
		const { content, body, footer } = renderEditor();
		expect(footer.parentElement?.tagName).toBe("FORM");
		expect(body.parentElement?.tagName).toBe("FORM");
		expect(body.contains(footer)).toBe(false);
		expect(body.classList.contains("overflow-y-auto")).toBe(true);
		expect(body.classList.contains("min-h-0")).toBe(true);
		expect(body.classList.contains("flex-1")).toBe(true);
		expect(content.classList.contains("overflow-hidden")).toBe(true);
		expect(content.classList.contains("overflow-y-auto")).toBe(false);
		expect(content.hasAttribute("data-full-screen-mobile")).toBe(true);
	});

	it("submits through the form and closes through a clean cancel", async () => {
		const user = userEvent.setup();
		const { onSubmit, onClose } = renderEditor();
		await user.type(screen.getByLabelText("Name"), "Insurance");
		await user.click(screen.getByRole("button", { name: "Add transaction" }));
		expect(onSubmit).toHaveBeenCalledTimes(1);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("disables submit while busy and keeps the busy guard on close", async () => {
		const user = userEvent.setup();
		const { onSubmit, onClose } = renderEditor({
			busy: true,
			pendingLabel: "Saving…",
		});
		const save = screen.getByRole("button", { name: "Saving…" });
		expect((save as HTMLButtonElement).disabled).toBe(true);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("keeps the discard confirmation outside the form", async () => {
		const user = userEvent.setup();
		const { onClose, footer } = renderEditor({ dirty: true });
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		const confirm = await screen.findByRole("alertdialog", {
			name: "Discard changes?",
		});
		expect(footer.contains(confirm)).toBe(false);
		await user.click(screen.getByRole("button", { name: "Continue editing" }));
		expect(onClose).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(
			await screen.findByRole("button", { name: "Discard changes" }),
		);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
