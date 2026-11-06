import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dialogScope, runInteractions } from "../mocks/interactions.ts";
import { stubMatchMedia } from "../mocks/testScope.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

beforeEach(() => {
	stubMatchMedia(true);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function Harness({
	busy = false,
	onCancel = () => {},
	onConfirm = () => {},
	error = null,
}: {
	busy?: boolean;
	onCancel?: () => void;
	onConfirm?: () => void;
	error?: string | null;
}) {
	const [open, setOpen] = useState(true);
	if (!open) return null;
	return (
		<ConfirmDialog
			title="Delete item?"
			onCancel={() => {
				onCancel();
				// Callers refuse to close while the request is in flight.
				if (!busy) setOpen(false);
			}}
			onConfirm={onConfirm}
			cancelLabel="Keep item"
			confirmLabel="Delete item"
			busyLabel="Deleting…"
			busy={busy}
			error={error}
		>
			<p>This cannot be undone.</p>
		</ConfirmDialog>
	);
}

describe("confirm dialog actions", () => {
	it("cancels from the explicit action", async () => {
		const onCancel = vi.fn();
		render(<Harness onCancel={onCancel} />);
		await runInteractions(
			[{ click: ["button", "Keep item"] }],
			dialogScope("Delete item?"),
		);
		await runInteractions([{ waitForTextGone: "Delete item?" }]);
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("confirms from the explicit action", async () => {
		const onConfirm = vi.fn();
		render(<Harness onConfirm={onConfirm} />);
		await runInteractions(
			[{ click: ["button", "Delete item"] }],
			dialogScope("Delete item?"),
		);
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it("shows the busy label, disables both actions, and vetoes close", async () => {
		const onCancel = vi.fn();
		render(<Harness busy onCancel={onCancel} />);
		const panel = () =>
			screen.getByRole("dialog").firstElementChild as HTMLElement;
		await waitFor(() => expect(panel().dataset.state).toBe("open"));
		await runInteractions(
			[
				{ expectDisabled: ["button", "Deleting…"] },
				{ expectDisabled: ["button", "Keep item"] },
				{ click: ["button", "Close dialog"] },
				{ cancel: true },
				{ backdrop: true },
			],
			dialogScope("Delete item?"),
		);
		expect(onCancel).not.toHaveBeenCalled();
		// A busy close request must not start the fade or latch the dialog.
		expect(panel().dataset.state).toBe("open");
		await runInteractions([{ expectPresent: ["dialog", "Delete item?"] }]);
	});

	it("keeps a failed action visible", async () => {
		render(<Harness error="The item could not be deleted." />);
		await runInteractions(
			[
				{
					expectText: "The item could not be deleted.",
				},
				{ expectEnabled: ["button", "Delete item"] },
			],
			dialogScope("Delete item?"),
		);
		expect(screen.getByText("The item could not be deleted.")).toBeTruthy();
	});
});
