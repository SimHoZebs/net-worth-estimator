import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReceiptImageActions } from "./ReceiptImageActions.tsx";

beforeEach(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute("open", "");
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute("open");
	};
});
afterEach(cleanup);

function props() {
	return {
		revision: 4,
		readOnly: false,
		busy: false,
		replacing: false,
		deleting: false,
		onReplace: vi.fn(async (_image: File, _revision: number) => {}),
		onDelete: vi.fn(async () => {}),
	};
}

it("confirms replacement and retains its original conflict revision", async () => {
	const handlers = props();
	const { rerender } = render(<ReceiptImageActions {...handlers} />);
	const image = new File(["pixels"], "replacement.png", { type: "image/png" });
	fireEvent.change(screen.getByLabelText("Replace receipt image"), {
		target: { files: [image] },
	});
	expect(screen.getByText(/clears extracted details/)).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Keep receipt" }));
	expect(handlers.onReplace).not.toHaveBeenCalled();
	fireEvent.change(screen.getByLabelText("Replace receipt image"), {
		target: { files: [image] },
	});
	rerender(<ReceiptImageActions {...handlers} revision={5} />);
	fireEvent.click(screen.getByRole("button", { name: "Replace receipt" }));
	await waitFor(() =>
		expect(handlers.onReplace).toHaveBeenCalledWith(image, 4),
	);
});

it("keeps a failed replacement open and exposes delete beside the image", async () => {
	const handlers = props();
	handlers.onReplace.mockRejectedValue(new Error("Upload rejected"));
	render(<ReceiptImageActions {...handlers} />);
	fireEvent.change(screen.getByLabelText("Replace receipt image"), {
		target: { files: [new File(["bad"], "bad.png")] },
	});
	fireEvent.click(screen.getByRole("button", { name: "Replace receipt" }));
	await waitFor(() => expect(screen.getByText("Upload rejected")).toBeTruthy());
	fireEvent.click(screen.getByRole("button", { name: "Keep receipt" }));
	fireEvent.click(screen.getByRole("button", { name: "Delete receipt" }));
	expect(screen.getByText(/all extracted, draft, and confirmed/)).toBeTruthy();
	const dialog = screen.getByRole("dialog", { name: "Delete this receipt?" });
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Delete receipt" }),
	);
	await waitFor(() => expect(handlers.onDelete).toHaveBeenCalledTimes(1));
});

it("hides image mutations for read-only viewers", () => {
	render(<ReceiptImageActions {...props()} readOnly />);
	expect(screen.queryByRole("button")).toBeNull();
	expect(screen.queryByLabelText("Replace receipt image")).toBeNull();
});
