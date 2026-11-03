import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runInteractions } from "../mocks/interactions.ts";
import {
	notifyError,
	notifySuccess,
	resetNotifications,
} from "../state/notifications.ts";
import { NotificationCenter } from "./NotificationCenter.tsx";

beforeEach(() => resetNotifications());

afterEach(cleanup);

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
	expect(onDismiss).toHaveBeenCalledOnce();
});

it("announces success as a status without an alert", () => {
	notifySuccess("save", "Changes saved.");
	render(<NotificationCenter />);
	expect(screen.getByRole("status").textContent).toContain("Changes saved.");
	expect(screen.queryByRole("alert")).toBeNull();
});
