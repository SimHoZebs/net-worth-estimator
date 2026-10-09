import { ArrowRight, GitBranch, RotateCcw } from "lucide-react";
import { changesBetween } from "../domain/model.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";

export function DraftBar({
	onDiscard,
	onReview,
}: {
	onDiscard: () => void;
	onReview: () => void;
}) {
	// Draft state subscribes here; only the navigation callback stays a prop.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const workspaceLoading = useWorkspaceStore((state) => state.loading);
	const importing = useUiStore((state) => state.importing);
	const loading = workspaceLoading || importing;
	const count =
		workspace && plan
			? changesBetween({ saved: workspace.saved, current: plan }).length
			: 0;
	if (!count) return null;
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
				>
					<RotateCcw size={15} />
					<span>Discard</span>
				</button>
				<button type="button" className="button primary" onClick={onReview}>
					Review & save <ArrowRight size={15} />
				</button>
			</div>
		</div>
	);
}
