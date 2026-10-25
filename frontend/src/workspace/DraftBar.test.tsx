import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetUiStore } from "../state/uiStore.ts";
import {
	resetNotifications,
	useNotifications,
} from "../state/notifications.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { testPlan } from "../test/plan.ts";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { DraftBar } from "./DraftBar.tsx";

function workspace(draft = false) {
	return {
		version: 1 as const,
		saved: testPlan,
		draft: draft ? { ...testPlan, name: "Edited household" } : null,
		baseFingerprint: null,
		baseRevision: null,
		draftStale: false,
	};
}

beforeEach(() => {
	resetWorkspaceStore();
	resetUiStore();
	resetNotifications();
	useWorkspaceStore.setState({ workspace: workspace(), loading: false });
});

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetUiStore();
	resetNotifications();
});

describe("draft bar presence", () => {
	it("exposes a state attribute only while changes exist", () => {
		const view = render(<DraftBar onDiscard={() => {}} />);
		expect(view.container.querySelector("[data-draft-bar]")).toBeNull();
		act(() => useWorkspaceStore.setState({ workspace: workspace(true) }));
		const message = view.getByText("1 unsaved change · saved plan unchanged");
		const bar = message.closest("[data-draft-bar]");
		expect(bar).not.toBeNull();
		expect(bar?.hasAttribute("data-testid")).toBe(false);
		act(() => useWorkspaceStore.setState({ workspace: workspace() }));
		expect(view.container.querySelector("[data-draft-bar]")).toBeNull();
	});

	it("preserves native save and discard controls", async () => {
		const save = vi.fn(async () => true);
		const onDiscard = vi.fn();
		useWorkspaceStore.setState({ workspace: workspace(true), save });
		const view = render(<DraftBar onDiscard={onDiscard} />);
		fireEvent.click(view.getByRole("button", { name: "Discard" }));
		expect(onDiscard).toHaveBeenCalledOnce();
		fireEvent.click(view.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(save).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(
				view
					.getByRole("button", { name: "Save changes" })
					.getAttribute("aria-busy"),
			).toBe("false"),
		);
	});

	it("preserves the toast status and dismissal without a test-only styling hook", () => {
		useWorkspaceStore.setState({ notice: "Plan saved." });
		const view = render(<NotificationCenter />);
		expect(view.getByRole("status").textContent).toContain("Plan saved.");
		fireEvent.click(view.getByRole("button", { name: "Dismiss notification" }));
		expect(view.queryByRole("status")).toBeNull();
		expect(useWorkspaceStore.getState().notice).toBe("");
		expect(useNotifications.getState().items).toHaveLength(0);
	});
});
