import { GitBranch, RotateCcw, Save } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { useUiStore } from "../state/uiStore.ts";
import {
	selectDraftChangeCount,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { useAccountReadOnly } from "../state/useAccountScope.ts";
import { useServerModel } from "../state/workspaceResources.ts";
import { saveWorkspace, useWorkspaceSaving } from "../state/workspaceWrites.ts";

export function DraftBar({ onDiscard }: { onDiscard: () => void }) {
	// Draft state subscribes here; the save runs through Query directly so
	// no review step or navigation callback is needed.
	const workspaceLoading = useServerModel().isFetching;
	const saving = useWorkspaceSaving();
	const readOnly = useAccountReadOnly();
	const importing = useUiStore((state) => state.importing);
	const count = useWorkspaceStore(selectDraftChangeCount);
	const loading = workspaceLoading || importing || saving;
	if (!count) return null;
	const saveChanges = () => {
		if (saving) return;
		void saveWorkspace();
	};
	return (
		<div
			data-draft-bar=""
			className="pointer-events-auto flex w-full flex-wrap items-center justify-between gap-3 rounded-surface border border-solid border-line-strong bg-surface p-3 shadow-lg backdrop-blur-sm sm:gap-4 sm:px-5 sm:py-4"
		>
			<div className="flex items-center gap-3">
				<span className="grid size-9 place-items-center rounded-surface bg-success-bg text-success-text max-sm:size-8">
					{loading ? (
						<span
							className="size-3 animate-spin rounded-full border-2 border-solid border-line-strong border-t-primary"
							aria-hidden="true"
						/>
					) : (
						<GitBranch size={18} />
					)}
				</span>
				<span className="flex flex-col">
					<strong className="text-xs">
						{loading
							? "Updating unsaved changes…"
							: `${count} unsaved ${count === 1 ? "change" : "changes"} · not saved yet`}
					</strong>
				</span>
			</div>
			<div className="flex items-center gap-3 max-sm:ml-auto">
				<Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
					<RotateCcw size={15} />
					<span>Discard</span>
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={readOnly || saving || loading}
					onClick={() => void saveChanges()}
					aria-busy={saving}
				>
					<Save size={15} />
					<span>{saving ? "Saving…" : "Save changes"}</span>
				</Button>
			</div>
		</div>
	);
}
