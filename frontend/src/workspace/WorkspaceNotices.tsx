import { Check, LockKeyhole, X } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorNotice, IconButton } from "../components/ui.tsx";
import type { Plan } from "../domain/model.ts";
import { download } from "../state/storage.ts";
import type { WorkspaceController } from "./types.ts";

function errorRecovery({
	state,
	serverMode,
}: {
	state: WorkspaceController;
	serverMode: boolean;
}) {
	if (state.error?.includes("stale"))
		return {
			action: "Discard draft and load latest",
			onAction: () => void state.reloadDraft(),
		};
	if (state.error?.includes("another tab"))
		return {
			action: "Reload latest saved plan",
			onAction: () => window.location.reload(),
		};
	return {
		action: serverMode ? "Retry server request" : "Retry browser save",
		onAction: state.retry,
	};
}

export function workspaceStatusLabel({
	serverMode,
	readOnly,
	authTokenActive,
	authRequired,
}: {
	serverMode: boolean;
	readOnly: boolean;
	authTokenActive: boolean;
	authRequired: boolean;
}) {
	return !serverMode
		? "Local workspace"
		: readOnly
			? "Server read-only"
			: authTokenActive
				? "Server · token in memory"
				: authRequired
					? "Auth required"
					: "Server workspace";
}

export function WorkspaceNotices({
	state,
	plan,
	serverMode,
	readOnly,
	authControl,
}: {
	state: WorkspaceController;
	plan: Plan;
	serverMode: boolean;
	readOnly: boolean;
	authControl?: ReactNode;
}) {
	return (
		<>
			{state.error && (
				<ErrorNotice
					message={state.error}
					{...errorRecovery({ state, serverMode })}
				/>
			)}
			{authControl}
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
					{serverMode
						? "Export local draft recovery"
						: "Export work before leaving"}
				</button>
			)}
			{readOnly && (
				<div className="inline-notice">
					<LockKeyhole size={17} />
					{serverMode
						? "This server is read-only. You can test changes and export a copy; the saved server model cannot be replaced."
						: "This source is read-only. You can test changes and export a copy; the saved source cannot be edited."}
				</div>
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
