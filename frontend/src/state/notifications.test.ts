import { afterEach, describe, expect, it } from "vitest";
import { suspendResourceScope } from "../auth/resourceScope.ts";
import { resetNotifications, useNotifications } from "./notifications.ts";

afterEach(() => {
	resetNotifications();
	suspendResourceScope();
});

describe("notification stack", () => {
	it("pushes and dismisses toasts", () => {
		const id = useNotifications
			.getState()
			.notify({ key: "workspace", kind: "error", message: "Load failed." });
		expect(id).toBe("toast-1");
		expect(useNotifications.getState().items).toHaveLength(1);
		useNotifications.getState().dismiss(id);
		expect(useNotifications.getState().items).toHaveLength(0);
	});

	it("replaces the toast for a repeated key instead of stacking", () => {
		const store = useNotifications.getState();
		store.notify({ key: "workspace", kind: "error", message: "First." });
		store.notify({ key: "workspace", kind: "error", message: "Second." });
		const items = useNotifications.getState().items;
		expect(items).toHaveLength(1);
		expect(items[0]?.message).toBe("Second.");
	});

	it("keeps only the newest toasts past the cap", () => {
		const store = useNotifications.getState();
		for (let index = 0; index < 6; index += 1)
			store.notify({
				key: `source-${index}`,
				kind: "error",
				message: `Failure ${index}.`,
			});
		const items = useNotifications.getState().items;
		expect(items).toHaveLength(4);
		expect(items[0]?.message).toBe("Failure 5.");
		expect(items[3]?.message).toBe("Failure 2.");
	});

	it("starts clean on a new resource scope", () => {
		useNotifications
			.getState()
			.notify({ key: "workspace", kind: "error", message: "Load failed." });
		suspendResourceScope();
		expect(useNotifications.getState().items).toHaveLength(0);
	});
});
