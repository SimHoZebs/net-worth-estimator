import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suspendUserScope } from "../auth/resourceScope.ts";
import { toast } from "../components/ui/toast.tsx";
import { dismissKey, notifyError, notifySuccess } from "./notifications.ts";

let published: {
	id?: string;
	type?: unknown;
	description?: unknown;
	actionProps?: { children?: unknown; onClick?: unknown };
	onClose?: unknown;
}[] = [];
let closed: (string | undefined)[] = [];

beforeEach(() => {
	vi.spyOn(toast, "add").mockImplementation((options) => {
		published.push(options);
		return options.id ?? "toast-test";
	});
	vi.spyOn(toast, "close").mockImplementation((id) => {
		closed.push(id);
	});
	toast.close();
	suspendUserScope();
	published = [];
	closed = [];
});

afterEach(() => {
	toast.close();
	suspendUserScope();
});

describe("notification policy", () => {
	it("publishes errors with a stable key and urgent priority", () => {
		notifyError("workspace", "Load failed.");
		expect(published).toContainEqual(
			expect.objectContaining({
				id: "workspace",
				type: "error",
				description: "Load failed.",
				priority: "high",
			}),
		);
	});

	it("publishes confirmations with a calm priority", () => {
		notifySuccess("workspace-notice", "Changes saved.");
		expect(published).toContainEqual(
			expect.objectContaining({
				id: "workspace-notice",
				type: "success",
				description: "Changes saved.",
				priority: "low",
			}),
		);
	});

	it("replaces the toast for a repeated key instead of stacking", () => {
		notifyError("workspace", "First.");
		notifyError("workspace", "Second.");
		expect(
			published.filter((options) => options.id === "workspace"),
		).toHaveLength(2);
		expect(closed).not.toContain("workspace");
	});

	it("adapts actions and dismissal callbacks to the manager", () => {
		const onAction = vi.fn();
		const onDismiss = vi.fn();
		notifyError(
			"workspace",
			"Load failed.",
			{ label: "Retry", onAction },
			onDismiss,
		);
		const options = published.find((entry) => entry.id === "workspace");
		expect(options?.actionProps).toMatchObject({ children: "Retry" });
		(options?.actionProps?.onClick as (() => void) | undefined)?.();
		expect(onAction).toHaveBeenCalledTimes(1);
		(options?.onClose as (() => void) | undefined)?.();
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("clears one key while keeping the rest", () => {
		notifyError("account", "First.");
		notifyError("workspace", "Second.");
		dismissKey("account");
		expect(closed).toContain("account");
		expect(closed).not.toContain("workspace");
	});

	it("starts clean on a new resource scope", () => {
		notifyError("workspace", "Load failed.");
		suspendUserScope();
		expect(closed).toContain(undefined);
	});
});
