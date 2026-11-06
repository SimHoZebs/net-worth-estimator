import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubMatchMedia } from "../mocks/testScope.tsx";
import { Drawer } from "./Drawer.tsx";

// The shared setup stubs only the dialog open state. Top layer, focus
// containment, Escape, and focus return are the browser's job and are
// covered by the browser suite.
beforeEach(() => {
	stubMatchMedia(false);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

/** The browser turns Escape into a cancel request on the topmost dialog. */
function requestCancel(dialog: HTMLElement) {
	fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
}

/** The browser reports a backdrop click at coordinates outside the dialog. */
function clickBackdrop(dialog: HTMLElement) {
	vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
		left: 0,
		right: 240,
		top: 0,
		bottom: 800,
		width: 240,
		height: 800,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});
	fireEvent.click(dialog, { clientX: 320, clientY: 100 });
}

describe("drawer semantics", () => {
	it("closes the dialog with the native cancel request through the animated close", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Navigation" onClose={onClose}>
				<a href="/outlook">Outlook</a>
			</Drawer>,
		);
		const dialog = view.getByRole("dialog", { name: "Navigation" });
		requestCancel(dialog);
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});
	it("moves focus into the modal sheet and leaves the persistent sheet alone", () => {
		const page = render(<button type="button">Page action</button>);
		const action = page.getByRole("button", { name: "Page action" });
		action.focus();
		const sheet = (modal: boolean) => (
			<Drawer
				side="left"
				open
				label="Workspace navigation"
				onClose={() => {}}
				behavior={{ modal }}
			>
				<a href="/outlook">Outlook</a>
			</Drawer>
		);
		const view = render(sheet(false));
		expect(document.activeElement).toBe(action);
		view.rerender(sheet(true));
		const dialog = view.getByRole("dialog", {
			name: "Workspace navigation",
		});
		expect(document.activeElement).toBe(dialog);
	});
	it("exposes modal navigation by its dialog role and label", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Workspace navigation" onClose={onClose}>
				<button type="button">Navigation action</button>
			</Drawer>,
		);
		const dialog = view.getByRole("dialog", { name: "Workspace navigation" });
		// Focus lands on the panel itself, never on a queried child.
		expect(document.activeElement).toBe(dialog);
		expect(dialog.hasAttribute("aria-modal")).toBe(false);
		requestCancel(dialog);
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("keeps persistent navigation complementary without taking focus", () => {
		const onClose = vi.fn();
		const page = render(<button type="button">Page action</button>);
		const action = page.getByRole("button", { name: "Page action" });
		action.focus();
		const view = render(
			<Drawer
				side="left"
				open
				label="Workspace navigation"
				onClose={onClose}
				behavior={{ modal: false, swipeClose: false }}
			>
				<a href="/outlook">Outlook</a>
			</Drawer>,
		);
		const navigation = view.getByRole("complementary", {
			name: "Workspace navigation",
		});
		expect(
			within(navigation).getByRole("link", { name: "Outlook" }),
		).toBeTruthy();
		expect(view.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(action);
	});

	it("settles focus on the topmost sheet when two modal drawers overlap", async () => {
		const closeLower = vi.fn();
		const closeUpper = vi.fn();
		const view = render(
			<>
				<Drawer side="left" open label="Lower sheet" onClose={closeLower}>
					<button type="button">Lower action</button>
				</Drawer>
				<Drawer
					side="right"
					open
					label="Upper sheet"
					onClose={closeUpper}
					appearance={{ title: "Upper" }}
				>
					<p>Upper content</p>
				</Drawer>
			</>,
		);
		const upper = view.getByRole("dialog", { name: "Upper" });
		expect(document.activeElement).toBe(upper);
		requestCancel(upper);
		// Only the topmost sheet starts closing; the lower sheet stays silent.
		expect(closeUpper).not.toHaveBeenCalled();
		expect(closeLower).not.toHaveBeenCalled();
		await waitFor(() => expect(closeUpper).toHaveBeenCalledOnce());
		expect(closeLower).not.toHaveBeenCalled();
	});

	it("names a context dialog from its heading", () => {
		const view = render(
			<Drawer
				side="right"
				open
				label="Account details"
				onClose={() => {}}
				appearance={{ title: "Savings", eyebrow: "Account details" }}
			>
				<p>Account balance</p>
			</Drawer>,
		);
		const dialog = view.getByRole("dialog", { name: "Savings" });
		expect(
			within(dialog).getByRole("heading", { name: "Savings" }),
		).toBeTruthy();
		expect(within(dialog).getByText("Account details")).toBeTruthy();
		expect(
			within(dialog).getByRole("button", { name: "Close dialog" }),
		).toBeTruthy();
	});
});

describe("animated close", () => {
	it("starts a fresh session when externally dismissed and immediately reopened", async () => {
		const onClose = vi.fn();
		const sheet = (open: boolean) => (
			<Drawer
				side="right"
				open={open}
				label="Context"
				onClose={onClose}
				appearance={{ title: "Context" }}
			>
				<p>Details</p>
			</Drawer>
		);
		const view = render(sheet(true));
		const previous = view.getByRole("dialog", { name: "Context" });
		fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
		view.rerender(sheet(false));
		expect(view.queryByRole("dialog")).toBeNull();
		view.rerender(sheet(true));
		const reopened = view.getByRole("dialog", { name: "Context" });
		expect(reopened).not.toBe(previous);
		await waitFor(() => expect(reopened.dataset.state).toBe("open"));
		expect(onClose).not.toHaveBeenCalled();
		requestCancel(reopened);
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});
	it("does not complete an old close action after external navigation removes the drawer", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer
				side="right"
				open
				label="Context"
				onClose={onClose}
				appearance={{ title: "Context" }}
			>
				<p>Details</p>
			</Drawer>,
		);
		fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
		view.rerender(
			<Drawer
				side="right"
				open={false}
				label="Context"
				onClose={onClose}
				appearance={{ title: "Context" }}
			>
				<p>Details</p>
			</Drawer>,
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(onClose).not.toHaveBeenCalled();
	});
	it("closes once when cancel fires twice before the animation completes", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Navigation" onClose={onClose}>
				<a href="/outlook">Outlook</a>
			</Drawer>,
		);
		const dialog = view.getByRole("dialog", { name: "Navigation" });
		requestCancel(dialog);
		requestCancel(dialog);
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("animates a backdrop click instead of closing synchronously", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Navigation" onClose={onClose}>
				<a href="/outlook">Outlook</a>
			</Drawer>,
		);
		clickBackdrop(view.getByRole("dialog", { name: "Navigation" }));
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("ignores a click inside the sheet rectangle", () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Navigation" onClose={onClose}>
				<a href="/outlook">Outlook</a>
			</Drawer>,
		);
		const dialog = view.getByRole("dialog", { name: "Navigation" });
		vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
			left: 0,
			right: 240,
			top: 0,
			bottom: 800,
			width: 240,
			height: 800,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});
		fireEvent.click(dialog, { clientX: 200, clientY: 400 });
		expect(onClose).not.toHaveBeenCalled();
	});

	it("animates the corner button dismissal instead of closing synchronously", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer
				side="right"
				open
				label="Account details"
				onClose={onClose}
				appearance={{ title: "Savings" }}
			>
				<p>Account balance</p>
			</Drawer>,
		);
		fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("closes a left sheet with a closing swipe through the same animated path", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Navigation" onClose={onClose}>
				<a href="/outlook">Outlook</a>
			</Drawer>,
		);
		const panel = view.getByRole("dialog", { name: "Navigation" });
		const start = new Event("touchstart", {
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		Object.defineProperty(start, "touches", {
			value: [{ clientX: 200, clientY: 100 }],
		});
		const end = new Event("touchend", {
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		Object.defineProperty(end, "changedTouches", {
			value: [{ clientX: 100, clientY: 100 }],
		});
		act(() => {
			panel.dispatchEvent(start);
			panel.dispatchEvent(end);
		});
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("closes immediately with reduced motion", () => {
		stubMatchMedia(true);
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Navigation" onClose={onClose}>
				<a href="/outlook">Outlook</a>
			</Drawer>,
		);
		requestCancel(view.getByRole("dialog", { name: "Navigation" }));
		// No exit frame is requested when the user has reduced motion.
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("reopens cleanly after an animated close", async () => {
		const onClose = vi.fn();
		function Harness() {
			const [open, setOpen] = useState(true);
			return (
				<>
					<button type="button" onClick={() => setOpen(true)}>
						Reopen
					</button>
					<Drawer
						side="right"
						open={open}
						label="Account details"
						onClose={() => {
							onClose();
							setOpen(false);
						}}
						appearance={{ title: "Savings" }}
					>
						<p>Account balance</p>
					</Drawer>
				</>
			);
		}
		const view = render(<Harness />);
		fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Savings" })).toBeNull(),
		);
		// A fresh open session starts outside the exit: no spurious close
		// and focus lands on the new panel.
		fireEvent.click(view.getByRole("button", { name: "Reopen" }));
		const dialog = await view.findByRole("dialog", { name: "Savings" });
		expect(document.activeElement).toBe(dialog);
		expect(onClose).toHaveBeenCalledOnce();
		requestCancel(dialog);
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
	});

	it("stops a nested sheet cancel from bubbling through portal ancestry", async () => {
		const closeOuter = vi.fn();
		const closeInner = vi.fn();
		const view = render(
			<Drawer side="left" open label="Outer sheet" onClose={closeOuter}>
				<Drawer side="right" open label="Inner sheet" onClose={closeInner}>
					<button type="button">Inner action</button>
				</Drawer>
			</Drawer>,
		);
		requestCancel(view.getByRole("dialog", { name: "Inner sheet" }));
		await waitFor(() => expect(closeInner).toHaveBeenCalledOnce());
		expect(closeOuter).not.toHaveBeenCalled();
	});

	it("closes stacked sheets top-down while preserving the lower sheet", async () => {
		const closeLower = vi.fn();
		const closeUpper = vi.fn();
		function Stack() {
			const [upperOpen, setUpperOpen] = useState(true);
			const [lowerOpen, setLowerOpen] = useState(true);
			return (
				<>
					<Drawer
						side="left"
						open={lowerOpen}
						label="Lower sheet"
						onClose={() => {
							closeLower();
							setLowerOpen(false);
						}}
					>
						<button type="button">Lower action</button>
					</Drawer>
					<Drawer
						side="right"
						open={upperOpen}
						label="Upper sheet"
						onClose={() => {
							closeUpper();
							setUpperOpen(false);
						}}
						appearance={{ title: "Upper" }}
					>
						<p>Upper content</p>
					</Drawer>
				</>
			);
		}
		const view = render(<Stack />);
		requestCancel(view.getByRole("dialog", { name: "Upper" }));
		await waitFor(() => expect(closeUpper).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Upper" })).toBeNull(),
		);
		expect(closeLower).not.toHaveBeenCalled();
		// The surviving lower sheet owns the next cancel request.
		const lower = view.getByRole("dialog", { name: "Lower sheet" });
		requestCancel(lower);
		await waitFor(() => expect(closeLower).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Lower sheet" })).toBeNull(),
		);
	});
});
