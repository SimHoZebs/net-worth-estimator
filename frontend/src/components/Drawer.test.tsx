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

beforeEach(() => {
	stubMatchMedia(false);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("drawer semantics", () => {
	it("closes the topmost modal with Escape through the animated close", async () => {
		const page = render(<button type="button">Open navigation</button>);
		page.getByRole("button", { name: "Open navigation" }).focus();
		const onClose = vi.fn();
		render(
			<Drawer
				side="left"
				open
				label="Navigation"
				onClose={onClose}
				behavior={{ autoFocus: false }}
			>
				<a href="#outlook">Outlook</a>
			</Drawer>,
		);
		// Escape funnels through requestClose like every other close path:
		// no synchronous onClose, and the key is owned (default prevented).
		const prevented = fireEvent.keyDown(window, { key: "Escape" });
		expect(prevented).toBe(false);
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});
	it("captures the mobile opener after persistent desktop navigation", async () => {
		const page = render(<button type="button">Open navigation</button>);
		const opener = page.getByRole("button", { name: "Open navigation" });
		const sheet = (open: boolean, modal: boolean) => (
			<Drawer
				side="left"
				open={open}
				label="Navigation"
				onClose={() => {}}
				behavior={{ modal }}
			>
				<a href="#outlook">Outlook</a>
			</Drawer>
		);
		const view = render(sheet(true, false));
		view.rerender(sheet(false, true));
		opener.focus();
		view.rerender(sheet(true, true));
		expect(document.activeElement).toBe(
			view.getByRole("dialog", { name: "Navigation" }),
		);
		view.rerender(sheet(false, true));
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});
	it("exposes modal navigation by its dialog role and label", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Workspace navigation" onClose={onClose}>
				<button type="button">Navigation action</button>
			</Drawer>,
		);
		const dialog = view.getByRole("dialog", { name: "Workspace navigation" });
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		// Focus lands on the panel itself, never on a queried child.
		expect(document.activeElement).toBe(dialog);
		expect(
			view.getByRole("button", { name: "Close Workspace navigation" }),
		).toBeTruthy();
		fireEvent.keyDown(window, { key: "Escape" });
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
				behavior={{ modal: false, backdrop: false, swipeClose: false }}
			>
				<a href="#outlook">Outlook</a>
			</Drawer>,
		);
		const navigation = view.getByRole("complementary", {
			name: "Workspace navigation",
		});
		expect(navigation.hasAttribute("aria-modal")).toBe(false);
		expect(
			within(navigation).getByRole("link", { name: "Outlook" }),
		).toBeTruthy();
		expect(
			view.queryByRole("button", { name: "Close Workspace navigation" }),
		).toBeNull();
		expect(document.activeElement).toBe(action);
		within(navigation).getByRole("link", { name: "Outlook" }).focus();
		const escape = new KeyboardEvent("keydown", {
			key: "Escape",
			cancelable: true,
		});
		window.dispatchEvent(escape);
		expect(escape.defaultPrevented).toBe(false);
		expect(onClose).not.toHaveBeenCalled();
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
		fireEvent.keyDown(window, { key: "Escape" });
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
		await waitFor(() => expect(reopened.style.opacity).toBe("1"));
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.keyDown(window, { key: "Escape" });
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
	it("closes once when Escape fires twice before the animation completes", async () => {
		const onClose = vi.fn();
		render(
			<Drawer
				side="left"
				open
				label="Navigation"
				onClose={onClose}
				behavior={{ autoFocus: false }}
			>
				<a href="#outlook">Outlook</a>
			</Drawer>,
		);
		fireEvent.keyDown(window, { key: "Escape" });
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("animates backdrop dismissal instead of closing synchronously", async () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Navigation" onClose={onClose}>
				<a href="#outlook">Outlook</a>
			</Drawer>,
		);
		fireEvent.click(view.getByRole("button", { name: "Close Navigation" }));
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
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
			<Drawer
				side="left"
				open
				label="Navigation"
				onClose={onClose}
				behavior={{ autoFocus: false }}
			>
				<a href="#outlook">Outlook</a>
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

	it("completes the animated close with reduced motion", async () => {
		stubMatchMedia(true);
		const onClose = vi.fn();
		render(
			<Drawer
				side="left"
				open
				label="Navigation"
				onClose={onClose}
				behavior={{ autoFocus: false }}
			>
				<a href="#outlook">Outlook</a>
			</Drawer>,
		);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
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
		fireEvent.click(
			view.getByRole("button", { name: "Close Account details" }),
		);
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Savings" })).toBeNull(),
		);
		// A fresh open session starts outside the exit: no spurious close,
		// focus captured again, and Escape closes anew.
		fireEvent.click(view.getByRole("button", { name: "Reopen" }));
		const dialog = await view.findByRole("dialog", { name: "Savings" });
		expect(document.activeElement).toBe(dialog);
		expect(onClose).toHaveBeenCalledOnce();
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
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
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(closeUpper).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Upper" })).toBeNull(),
		);
		expect(closeLower).not.toHaveBeenCalled();
		// The surviving lower sheet is topmost again and owns the next Escape.
		const lower = view.getByRole("dialog", { name: "Lower sheet" });
		await waitFor(() => expect(document.activeElement).toBe(lower));
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(closeLower).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Lower sheet" })).toBeNull(),
		);
	});
});
