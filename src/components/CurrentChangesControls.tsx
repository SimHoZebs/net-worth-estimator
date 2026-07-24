import { useShallow } from "zustand/shallow";
import { TemporaryAccountForm } from "@/components/dashboard/current-changes/TemporaryAccountForm";
import { TemporaryCheckpointForm } from "@/components/dashboard/current-changes/TemporaryCheckpointForm";
import { TemporaryPostingForm } from "@/components/dashboard/current-changes/TemporaryPostingForm";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { StatusPill } from "@/components/ui/status-pill";
import type { FinancialModelDocument } from "@/lib/projection";
import { selectCurrentChangeCount, useStore } from "@/store";

interface CurrentChangesControlsProps {
	document: FinancialModelDocument;
}

export function CurrentChangesControls({
	document,
}: CurrentChangesControlsProps) {
	const currentChanges = useStore(
		useShallow((s) => ({
			addedAccounts: s.addedAccounts,
			addedPostings: s.addedPostings,
			addedCheckpoints: s.addedCheckpoints,
		})),
	);
	const currentChangeCount = useStore(selectCurrentChangeCount);
	const resetCurrentChanges = useStore((s) => s.resetCurrentChanges);
	const addTemporaryAccount = useStore((s) => s.addTemporaryAccount);
	const removeTemporaryAccount = useStore((s) => s.removeTemporaryAccount);
	const addTemporaryPosting = useStore((s) => s.addTemporaryPosting);
	const removeTemporaryPosting = useStore((s) => s.removeTemporaryPosting);
	const addTemporaryCheckpoint = useStore((s) => s.addTemporaryCheckpoint);
	const removeTemporaryCheckpoint = useStore(
		(s) => s.removeTemporaryCheckpoint,
	);

	return (
		<Collapsible autoOpenWhen={currentChangeCount > 0}>
			<Collapsible.Trigger>
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-start gap-3">
						<Collapsible.Chevron />
						<div>
							<div className="type-title text-base">Current changes</div>
							<div className="type-muted">
								{currentChangeCount > 0
									? `${currentChangeCount} temporary change${currentChangeCount === 1 ? "" : "s"} active.`
									: "Temporarily add trial accounts, scheduled transactions, and balance checkpoints."}
							</div>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{currentChangeCount > 0 ? (
							<StatusPill>{currentChangeCount} active</StatusPill>
						) : null}
						<span className="type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70">
							Show details
						</span>
					</div>
				</div>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<div className="space-y-6">
					<div className="flex justify-end">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={resetCurrentChanges}
							disabled={currentChangeCount === 0}
						>
							Reset current changes
						</Button>
					</div>

					<div className="space-y-3">
						<h3 className="type-body type-value font-semibold/80">
							Temporary additions
						</h3>

						<TemporaryAccountForm
							accounts={currentChanges.addedAccounts}
							onAdd={addTemporaryAccount}
							onRemove={removeTemporaryAccount}
						/>

						<TemporaryPostingForm
							postings={currentChanges.addedPostings}
							document={document}
							onAdd={addTemporaryPosting}
							onRemove={removeTemporaryPosting}
						/>

						<TemporaryCheckpointForm
							checkpoints={currentChanges.addedCheckpoints}
							onAdd={addTemporaryCheckpoint}
							onRemove={removeTemporaryCheckpoint}
						/>
					</div>
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}
