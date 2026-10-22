import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
	it("exposes modal navigation by its dialog role and label", () => {
		const onClose = vi.fn();
		const view = render(
			<Drawer side="left" open label="Workspace navigation" onClose={onClose}>
				<button type="button">Navigation action</button>
			</Drawer>,
		);
		const dialog = view.getByRole("dialog", { name: "Workspace navigation" });
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		expect(document.activeElement).toBe(
			within(dialog).getByRole("button", { name: "Navigation action" }),
		);
		expect(
			view.getByRole("button", { name: "Close Workspace navigation" }),
		).toBeTruthy();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("keeps persistent navigation complementary without taking focus", () => {
		const page = render(<button type="button">Page action</button>);
		const action = page.getByRole("button", { name: "Page action" });
		action.focus();
		const view = render(
			<Drawer
				side="left"
				open
				label="Workspace navigation"
				onClose={() => {}}
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
