import {
	useSuccessToast,
	useErrorToast,
} from "../components/NotificationCenter.tsx";
import { useWorkspaceStore } from "../state/workspaceStore.ts";

function useErrorRecovery(): { action: string; onAction: () => void } {
	const stale = useWorkspaceStore(
		(state) =>
			(state.workspace?.draftStale ?? false) ||
			state.errorCode === "stale-draft",
	);
	const storageConflict = useWorkspaceStore(
		(state) =>
			state.errorCode === "storage-conflict" ||
			(state.error?.includes("changed in another tab") ?? false),
	);
	const reloadDraft = useWorkspaceStore((state) => state.reloadDraft);
	const retry = useWorkspaceStore((state) => state.retry);
	if (stale)
		return {
			action: "Discard draft and load latest",
			onAction: () => void reloadDraft(),
		};
	if (storageConflict)
		return {
			action: "Reload latest saved plan",
			onAction: () => window.location.reload(),
		};
	return {
		action: "Retry server request",
		onAction: () => void retry(),
	};
}

export function workspaceStatusLabel({ readOnly }: { readOnly: boolean }) {
	return readOnly ? "Read-only" : "Workspace";
}

/**
 * Bridges workspace store state into the floating notification stack.
 * Renders nothing; WorkspaceShell and the recovery screen mount it so
 * errors and confirmations float instead of shoving content.
 */
export function WorkspaceNotices() {
	const error = useWorkspaceStore((state) => state.error);
	const errorCode = useWorkspaceStore((state) => state.errorCode);
	const recovery = useErrorRecovery();
	// The recovery screen explains a missing model itself with an import
	// call to action; floating the same message would only duplicate it.
	const visible =
		errorCode !== "missing-model" && !error?.includes("no financial model")
			? error
			: null;
	useErrorToast("workspace", visible, {
		label: recovery.action,
		onAction: recovery.onAction,
	});
	return null;
}

export function WorkspaceNotification() {
	const notice = useWorkspaceStore((state) => state.notice);
	const dismissNotice = useWorkspaceStore((state) => state.dismissNotice);
	useSuccessToast("workspace-notice", notice || null, dismissNotice);
	return null;
}
