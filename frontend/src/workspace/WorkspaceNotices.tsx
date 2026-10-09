import { Check, X } from "lucide-react";
import { ErrorNotice, IconButton } from "../components/ui.tsx";
import { download } from "../state/storage.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";

function useErrorRecovery(): { action: string; onAction: () => void } {
	const stale = useWorkspaceStore(
		(state) => state.workspace?.draftStale ?? false,
	);
	const storageConflict = useWorkspaceStore(
		(state) => state.error?.includes("changed in another tab") ?? false,
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

export function workspaceStatusLabel({
	readOnly,
}: {
	readOnly: boolean;
	authTokenActive?: boolean;
	authRequired?: boolean;
}) {
	return readOnly ? "Read-only" : "Workspace";
}

export function WorkspaceNotices() {
	const error = useWorkspaceStore((state) => state.error);
	const volatile = useWorkspaceStore((state) => state.volatile);
	const plan = useWorkspaceStore((state) => {
		const workspace = state.workspace;
		return workspace?.draft ?? workspace?.saved ?? null;
	});
	const recovery = useErrorRecovery();
	return (
		<>
			{error && <ErrorNotice message={error} {...recovery} />}
			{volatile && plan && (
				<button
					type="button"
					className="button secondary export-recovery"
					onClick={() =>
						download({
							name: "waypoint-recovery.json",
							content: JSON.stringify(plan, null, 2),
						})
					}
				>
					"Export local draft recovery"
				</button>
			)}
		</>
	);
}

export function WorkspaceNotification() {
	const notice = useWorkspaceStore((state) => state.notice);
	const dismissNotice = useWorkspaceStore((state) => state.dismissNotice);
	return notice ? (
		<div className="toast" role="status">
			<Check size={17} />
			<span>{notice}</span>
			<IconButton
				icon={X}
				label="Dismiss notification"
				onClick={dismissNotice}
			/>
		</div>
	) : null;
}
