import { useState } from "react";
import { GitBranch, RotateCcw, Save } from "lucide-react";
import { Button } from "../components/Button.tsx";
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
		<div
			data-draft-bar=""
			className="fixed right-10 bottom-5 left-[calc(var(--sidebar)+2.5rem)] z-20 flex justify-between gap-4 rounded-surface border border-solid border-line-strong bg-surface px-5 py-4 shadow-lg backdrop-blur-sm [@media(max-width:1250px)]:right-7 [@media(max-width:1250px)]:left-[calc(var(--sidebar)+1.75rem)] [@media(max-width:800px)]:right-5 [@media(max-width:800px)]:left-5 [@media(max-width:600px)]:right-3 [@media(max-width:600px)]:bottom-3 [@media(max-width:600px)]:left-3 [@media(max-width:600px)]:flex-wrap [@media(max-width:600px)]:gap-3 [@media(max-width:600px)]:p-3 print:hidden"
		>
			<div className="flex items-center gap-3">
				<span className="grid size-9 place-items-center rounded-lg bg-success-bg text-success-text [@media(max-width:600px)]:size-8">
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
							: `${count} unsaved ${count === 1 ? "change" : "changes"} · saved plan unchanged`}
					</strong>
				</span>
			</div>
			<div className="flex items-center gap-3 [@media(max-width:600px)]:ml-auto">
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
