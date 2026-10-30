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
	notifySuccess,
	resetNotifications,
	useNotifications,
} from "../state/notifications.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import {
	setServerModelFixture,
	setServerStatusFixture,
} from "../mocks/workspace.ts";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { saveWorkspace } from "../state/workspaceWrites.ts";
import { DraftBar } from "./DraftBar.tsx";

vi.mock("../state/workspaceWrites.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../state/workspaceWrites.ts")>()),
	saveWorkspace: vi.fn(async () => true),
}));

beforeEach(() => {
	acceptTestResource();
	resetWorkspaceStore();
	resetUiStore();
	resetNotifications();
	setServerModelFixture();
	setServerStatusFixture({ readOnly: false });
});
afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetUiStore();
	resetNotifications();
	vi.clearAllMocks();
});

describe("draft bar presence", () => {
	it("appears only while local changes exist", () => {
		const view = render(<DraftBar onDiscard={() => {}} />);
		expect(view.container.querySelector("[data-draft-bar]")).toBeNull();
		act(() =>
			useWorkspaceStore.setState({
				draft: { ...financialModelFixture, name: "Edited household" },
				baseline: financialModelFixture,
			}),
		);
		expect(view.getByText("1 unsaved change · not saved yet")).toBeTruthy();
		act(() => useWorkspaceStore.setState({ draft: null, baseline: null }));
		expect(view.container.querySelector("[data-draft-bar]")).toBeNull();
	});
	it("uses Query's save command and a local discard callback", async () => {
		useWorkspaceStore.setState({
			draft: { ...financialModelFixture, name: "Edited household" },
			baseline: financialModelFixture,
		});
		const onDiscard = vi.fn();
		const view = render(<DraftBar onDiscard={onDiscard} />);
		fireEvent.click(view.getByRole("button", { name: "Discard" }));
		expect(onDiscard).toHaveBeenCalledOnce();
		fireEvent.click(view.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(saveWorkspace).toHaveBeenCalledOnce());
	});
	it("lets the notification store own confirmation dismissal", () => {
		notifySuccess("workspace-notice", "Changes saved.");
		const view = render(<NotificationCenter />);
		expect(view.getByRole("status").textContent).toContain("Changes saved.");
		fireEvent.click(view.getByRole("button", { name: "Dismiss notification" }));
		expect(useNotifications.getState().items).toHaveLength(0);
		expect(useWorkspaceStore.getState()).not.toHaveProperty("notice");
	});
});
