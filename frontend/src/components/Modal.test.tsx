import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dialogScope, runInteractions } from "../mocks/interactions.ts";
import { stubMatchMedia } from "../mocks/testScope.tsx";
import { Modal } from "./Modal.tsx";

beforeEach(() => {
	// Collapse enter and exit motion so close callbacks settle in the test.
	stubMatchMedia(true);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function ModalHarness({
	guard,
	onClosed = () => {},
	focusPanelOnOpen = false,
}: {
	guard?: () => boolean;
	onClosed?: () => void;
	focusPanelOnOpen?: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open dialog
			</button>
			{open && (
				<Modal
					title="Test dialog"
					onClose={() => {
						setOpen(false);
						onClosed();
					}}
					onCloseRequest={guard}
					focusPanelOnOpen={focusPanelOnOpen}
				>
					<button type="button">Inside action</button>
				</Modal>
			)}
		</>
	);
}

describe("modal close requests", () => {
	it("closes through the header control", async () => {
		const onClosed = vi.fn();
		render(<ModalHarness onClosed={onClosed} />);
		await runInteractions([{ click: ["button", "Open dialog"] }]);
		await runInteractions(
			[{ waitForText: "Test dialog" }, { click: ["button", "Close dialog"] }],
			dialogScope("Test dialog"),
		);
		await runInteractions([{ waitForTextGone: "Test dialog" }]);
		expect(onClosed).toHaveBeenCalledOnce();
	});

	it("vetoes before the exit animation, then accepts a later request", async () => {
		let allowed = false;
		const guard = vi.fn(() => allowed);
		const onClosed = vi.fn();
		render(<ModalHarness guard={guard} onClosed={onClosed} />);
		await runInteractions([{ click: ["button", "Open dialog"] }]);
		const panel = () =>
			screen.getByRole("dialog").firstElementChild as HTMLElement;
		await waitFor(() => expect(panel().style.opacity).toBe("1"));
		await runInteractions(
			[{ click: ["button", "Close dialog"] }, { expectText: "Test dialog" }],
			dialogScope("Test dialog"),
		);
		expect(guard).toHaveBeenCalledOnce();
		expect(onClosed).not.toHaveBeenCalled();
		// The veto must not start the fade or latch the close.
		expect(panel().style.opacity).toBe("1");
		allowed = true;
		await runInteractions(
			[{ click: ["button", "Close dialog"] }],
			dialogScope("Test dialog"),
		);
		await runInteractions([{ waitForTextGone: "Test dialog" }]);
		expect(guard).toHaveBeenCalledTimes(2);
		expect(onClosed).toHaveBeenCalledOnce();
	});

	it("treats a backdrop click as a close request but not a content click", async () => {
		const onClosed = vi.fn();
		render(<ModalHarness onClosed={onClosed} />);
		await runInteractions([{ click: ["button", "Open dialog"] }]);
		await runInteractions(
			[{ click: ["button", "Inside action"] }],
			dialogScope("Test dialog"),
		);
		expect(onClosed).not.toHaveBeenCalled();
		await runInteractions([{ backdrop: true }], dialogScope("Test dialog"));
		await runInteractions([{ waitForTextGone: "Test dialog" }]);
		expect(onClosed).toHaveBeenCalledOnce();
	});

	it("routes the native cancel request through the guard", async () => {
		const guard = vi.fn(() => false);
		const onClosed = vi.fn();
		render(<ModalHarness guard={guard} onClosed={onClosed} />);
		await runInteractions([{ click: ["button", "Open dialog"] }]);
		await runInteractions([{ cancel: true }], dialogScope("Test dialog"));
		expect(guard).toHaveBeenCalledOnce();
		expect(onClosed).not.toHaveBeenCalled();
		await runInteractions([{ expectPresent: ["dialog", "Test dialog"] }]);
	});

	it("focuses the panel instead of its first control when asked", async () => {
		render(<ModalHarness focusPanelOnOpen />);
		await runInteractions([{ click: ["button", "Open dialog"] }]);
		const panel = screen.getByRole("dialog").firstElementChild;
		expect(document.activeElement).toBe(panel);
		expect(document.activeElement).not.toBe(
			screen.getByRole("button", { name: "Inside action" }),
		);
	});
});

describe("nested dialogs", () => {
	it("does not let an inner cancel request close the outer dialog", async () => {
		const closeOuter = vi.fn();
		const closeInner = vi.fn();
		render(
			<>
				<Modal title="Outer dialog" onClose={closeOuter}>
					<p>Outer content</p>
				</Modal>
				<Modal title="Inner dialog" onClose={closeInner}>
					<p>Inner content</p>
				</Modal>
			</>,
		);
		await runInteractions([{ cancel: true }], dialogScope("Inner dialog"));
		await waitFor(() => expect(closeInner).toHaveBeenCalled());
		expect(closeOuter).not.toHaveBeenCalled();
		await runInteractions([{ expectPresent: ["dialog", "Outer dialog"] }]);
	});
});
