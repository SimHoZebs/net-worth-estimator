import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "./Drawer.tsx";

beforeEach(() => {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("drawer semantics", () => {
	it("closes the topmost modal with Escape before focus enters it", () => {
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
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledOnce();
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
	it("exposes modal navigation by its dialog role and label", () => {
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
		expect(onClose).toHaveBeenCalledOnce();
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

	it("settles focus on the topmost sheet when two modal drawers overlap", () => {
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
		expect(closeUpper).toHaveBeenCalledOnce();
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
