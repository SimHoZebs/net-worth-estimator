import { ArrowRight, GitBranch, RotateCcw } from "lucide-react";

export function DraftBar({
	count,
	loading,
	onDiscard,
	onReview,
}: {
	count: number;
	loading: boolean;
	onDiscard: () => void;
	onReview: () => void;
}) {
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
							? "Updating the temporary version"
							: "Exploring a temporary version"}
					</strong>
					<small>
						{count} unsaved {count === 1 ? "change" : "changes"} · saved server
						plan unchanged
					</small>
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
