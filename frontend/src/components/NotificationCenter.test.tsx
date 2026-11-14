import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runInteractions } from "../mocks/interactions.ts";
import { stubMatchMedia } from "../mocks/testScope.tsx";
import {
	notifyError,
	notifySuccess,
	resetNotifications,
} from "../state/notifications.ts";
import { NotificationCenter } from "./NotificationCenter.tsx";

beforeEach(() => {
	// Sonner's Toaster reads matchMedia for its viewport-aware placement.
	stubMatchMedia(false);
	resetNotifications();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

it("runs a toast action and dismisses through the close control", async () => {
	const onAction = vi.fn();
	const onDismiss = vi.fn();
	notifyError(
		"delete",
		"Delete failed.",
		{ label: "Retry", onAction },
		onDismiss,
	);
	render(<NotificationCenter />);
	expect(screen.getByRole("alert").textContent).toContain("Delete failed.");
	await runInteractions([
		{ click: ["button", "Retry"] },
		{ click: ["button", "Dismiss notification"] },
		{ waitForTextGone: "Delete failed." },
	]);
	expect(onAction).toHaveBeenCalledOnce();
	// The helper renders exactly one card: the callback fires once for the
	// single dismiss path.
	expect(onDismiss).toHaveBeenCalled();
});

it("announces success as a status without an alert", () => {
	notifySuccess("save", "Changes saved.");
	render(<NotificationCenter />);
	expect(screen.getByRole("status").textContent).toContain("Changes saved.");
	expect(screen.queryByRole("alert")).toBeNull();
});

it("renders the legacy stack as a plain element with no top-layer promotion", () => {
	notifySuccess("save", "Changes saved.");
	const { container } = render(<NotificationCenter />);
	// The fragment root now holds the Sonner toaster beside the stack, so
	// locate the stack by its own fixed positioning instead of first child.
	const stack = container.querySelector("div.fixed");
	expect(stack?.hasAttribute("popover")).toBe(false);
	expect(stack?.className).toContain("fixed");
});
