import { useState } from "react";
import { GitBranch, RotateCcw, Save } from "lucide-react";
import { changesBetween } from "../domain/model.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";

export function DraftBar({ onDiscard }: { onDiscard: () => void }) {
	// Draft state subscribes here; the save runs against the store directly so
	// no review step or navigation callback is needed.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const workspaceLoading = useWorkspaceStore((state) => state.loading);
	const statusReadOnly = useWorkspaceStore(
		(state) => state.status?.readOnly ?? false,
	);
	const writeBlocked = useWorkspaceStore((state) => state.writeBlocked);
	const save = useWorkspaceStore((state) => state.save);
	const importing = useUiStore((state) => state.importing);
	const [saving, setSaving] = useState(false);
	const loading = workspaceLoading || importing;
	const readOnly = statusReadOnly || writeBlocked || (plan?.readOnly ?? true);
	const count =
		workspace && plan
			? changesBetween({ saved: workspace.saved, current: plan }).length
			: 0;
	if (!count) return null;
	const saveChanges = async () => {
		if (saving) return;
		setSaving(true);
		try {
			await save();
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="draft-bar">
			<div>
				<span className="draft-icon">
					{loading ? (
						<span className="spinner" aria-hidden="true" />
					) : (
						<GitBranch size={18} />
					)}
				</span>
				<span>
					<strong>
						{loading
							? "Updating unsaved changes…"
							: `${count} unsaved ${count === 1 ? "change" : "changes"} · saved plan unchanged`}
					</strong>
				</span>
			</div>
			<div>
				<button
					type="button"
					className="button draft-discard"
					onClick={onDiscard}
					disabled={saving}
				>
					<RotateCcw size={15} />
					<span>Discard</span>
				</button>
				<button
					type="button"
					className="button primary"
					disabled={readOnly || saving || loading}
					onClick={() => void saveChanges()}
					aria-busy={saving}
				>
					<Save size={15} />
					<span>{saving ? "Saving…" : "Save changes"}</span>
				</button>
			</div>
		</div>
	);
}
