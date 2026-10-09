import { Check, X } from "lucide-react";
import { ErrorNotice, IconButton } from "../components/ui.tsx";
import type { Plan } from "../domain/model.ts";
import { download } from "../state/storage.ts";
import type { WorkspaceController } from "./types.ts";

function errorRecovery({ state }: { state: WorkspaceController }) {
	if (state.stale)
		return {
			action: "Discard draft and load latest",
			onAction: () => void state.reloadDraft(),
		};
	if (state.storageConflict)
		return {
			action: "Reload latest saved plan",
			onAction: () => window.location.reload(),
		};
	return {
		action: "Retry server request",
		onAction: state.retry,
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

export function WorkspaceNotices({
	state,
	plan,
}: {
	state: WorkspaceController;
	plan: Plan;
	readOnly: boolean;
}) {
	return (
		<>
			{state.error && (
				<ErrorNotice message={state.error} {...errorRecovery({ state })} />
			)}
			{state.volatile && (
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

export function WorkspaceNotification({
	notice,
	onDismiss,
}: {
	notice: string;
	onDismiss: () => void;
}) {
	return notice ? (
		<div className="toast" role="status">
			<Check size={17} />
			<span>{notice}</span>
			<IconButton icon={X} label="Dismiss notification" onClick={onDismiss} />
		</div>
	) : null;
}
