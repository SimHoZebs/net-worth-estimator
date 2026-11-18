import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import { toast } from "../components/ui/toast.tsx";
import { dismissKey, notifyError, notifySuccess } from "./notifications.ts";

let published: {
	id?: string;
	type?: unknown;
	description?: unknown;
	priority?: unknown;
	actionProps?: {
		children?: unknown;
		onClick?: unknown;
		disabled?: unknown;
		"aria-busy"?: unknown;
	};
	onClose?: unknown;
}[] = [];
let closed: (string | undefined)[] = [];
let updated: { id: string; updates: unknown }[] = [];

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function optionsFor(key: string) {
	return published.filter((entry) => entry.id === key).at(-1);
}

function clickAction(key: string): void {
	const onClick = optionsFor(key)?.actionProps?.onClick as
		| (() => void)
		| undefined;
	onClick?.();
}

beforeEach(() => {
	vi.spyOn(toast, "add").mockImplementation((options) => {
		published.push(options);
		return options.id ?? "toast-test";
	});
	vi.spyOn(toast, "close").mockImplementation((id) => {
		closed.push(id);
	});
	vi.spyOn(toast, "update").mockImplementation((id, updater) => {
		const prior = optionsFor(id) ?? {};
		updated.push({
			id,
			updates:
				typeof updater === "function" ? updater(prior as never) : updater,
		});
	});
	toast.close();
	suspendUserScope();
	published = [];
	closed = [];
	updated = [];
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
		const options = optionsFor("workspace");
		expect(options?.actionProps).toMatchObject({ children: "Retry" });
		clickAction("workspace");
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

	it("publishes a loading update on click and keeps the original handler", async () => {
		let finish = (): void => {};
		const onAction = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		notifyError("workspace", "Load failed.", { label: "Retry", onAction });
		const onClick = optionsFor("workspace")?.actionProps?.onClick;
		clickAction("workspace");
		expect(updated).toHaveLength(1);
		expect(updated[0]).toEqual({
			id: "workspace",
			updates: expect.objectContaining({
				type: "loading",
				actionProps: {
					onClick,
					children: "Working…",
					disabled: true,
					"aria-busy": true,
				},
			}),
		});
		expect(updated[0]?.updates).not.toHaveProperty("description");
		finish();
		await settle();
	});

	it("uses the pending label and message overrides", async () => {
		let finish = (): void => {};
		const onAction = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		notifyError("workspace", "Load failed.", {
			label: "Retry",
			pendingLabel: "Retrying…",
			pendingMessage: "Retrying in the background.",
			onAction,
		});
		clickAction("workspace");
		expect(updated[0]?.updates).toMatchObject({
			type: "loading",
			description: "Retrying in the background.",
			actionProps: expect.objectContaining({ children: "Retrying…" }),
		});
		finish();
		await settle();
	});

	it("dismisses the key when the action resolves without a newer report", async () => {
		const onAction = vi.fn();
		notifyError("workspace", "Load failed.", { label: "Retry", onAction });
		clickAction("workspace");
		await settle();
		expect(closed).toContain("workspace");
		expect(published).toHaveLength(1);
	});

	it("republishes the error with the thrown message on rejection", async () => {
		notifyError("workspace", "Load failed.", {
			label: "Retry",
			onAction: () => Promise.reject(new Error("Still offline.")),
		});
		clickAction("workspace");
		await settle();
		expect(closed).not.toContain("workspace");
		expect(published).toHaveLength(2);
		expect(published[1]).toMatchObject({
			id: "workspace",
			type: "error",
			description: "Still offline.",
		});
		expect(published[1]?.actionProps?.onClick).toBeTypeOf("function");
	});

	it("stands down when the source republishes the same key", async () => {
		notifyError("workspace", "Load failed.", {
			label: "Retry",
			onAction: () => {
				notifyError("workspace", "Source failed.");
			},
		});
		clickAction("workspace");
		await settle();
		expect(closed).not.toContain("workspace");
		expect(published).toHaveLength(2);
		expect(published[1]?.description).toBe("Source failed.");
	});

	it("stands down when the source dismisses the key", async () => {
		notifyError("workspace", "Load failed.", {
			label: "Retry",
			onAction: () => {
				dismissKey("workspace");
			},
		});
		clickAction("workspace");
		await settle();
		expect(closed).toContain("workspace");
		expect(closed).toHaveLength(1);
		expect(published).toHaveLength(1);
	});

	it("stands down when the resource scope changes", async () => {
		notifyError("workspace", "Load failed.", {
			label: "Retry",
			onAction: () => {
				suspendUserScope();
			},
		});
		clickAction("workspace");
		await settle();
		expect(closed).toContain(undefined);
		expect(closed).not.toContain("workspace");
		expect(published).toHaveLength(1);
	});

	it("ignores a second click while the first action is in flight", async () => {
		let finish = (): void => {};
		const onAction = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		notifyError("workspace", "Load failed.", { label: "Retry", onAction });
		clickAction("workspace");
		clickAction("workspace");
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(updated).toHaveLength(1);
		finish();
		await settle();
	});

	it("keeps a newer run locked when an older run settles after a scope change", async () => {
		let finishFirst = (): void => {};
		notifyError("workspace", "First failure.", {
			label: "Retry",
			onAction: () =>
				new Promise<void>((resolve) => {
					finishFirst = resolve;
				}),
		});
		clickAction("workspace");

		suspendUserScope();
		expect(
			acceptUserScope(
				{
					apiBaseUrl: "http://example.test",
					resource: { id: "resource", permissions: [] },
					subject: "subject",
				},
				getUserScope(),
			),
		).not.toBeNull();

		let finishSecond = (): void => {};
		const second = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishSecond = resolve;
				}),
		);
		notifyError("workspace", "Second failure.", {
			label: "Retry",
			onAction: second,
		});
		clickAction("workspace");
		expect(second).toHaveBeenCalledTimes(1);

		finishFirst();
		await settle();
		clickAction("workspace");
		expect(second).toHaveBeenCalledTimes(1);

		finishSecond();
		await settle();
	});

	it("bumps generation on manual close and still calls onDismiss", async () => {
		let finish = (): void => {};
		const onAction = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const onDismiss = vi.fn();
		notifyError(
			"workspace",
			"Load failed.",
			{ label: "Retry", onAction },
			onDismiss,
		);
		clickAction("workspace");
		const onClose = optionsFor("workspace")?.onClose;
		expect(onClose).toBeTypeOf("function");
		(onClose as () => void)();
		expect(onDismiss).toHaveBeenCalledTimes(1);

		const replay = vi.fn(() => new Promise<void>(() => {}));
		notifyError("workspace", "Try again.", {
			label: "Retry",
			onAction: replay,
		});
		clickAction("workspace");
		expect(replay).toHaveBeenCalledTimes(1);

		finish();
		await settle();
		expect(closed).not.toContain("workspace");
		expect(published).toHaveLength(2);
	});
});
