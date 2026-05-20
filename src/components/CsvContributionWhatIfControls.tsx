import { useShallow } from "zustand/shallow";
import { WhatIfAccountForm } from "@/components/dashboard/what-if/WhatIfAccountForm";
import { WhatIfCheckpointForm } from "@/components/dashboard/what-if/WhatIfCheckpointForm";
import { WhatIfPostingForm } from "@/components/dashboard/what-if/WhatIfPostingForm";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { StatusPill } from "@/components/ui/status-pill";
import type { ScenarioPack } from "@/lib/projection";
import { selectActiveOverrideCount, useStore } from "@/store";

interface ContributionWhatIfControlsProps {
	pack: ScenarioPack;
}

export function ContributionWhatIfControls({
	pack,
}: ContributionWhatIfControlsProps) {
	const whatIfState = useStore(
		useShallow((s) => ({
			addedAccounts: s.addedAccounts,
			addedPostings: s.addedPostings,
			addedCheckpoints: s.addedCheckpoints,
		})),
	);
	const activeOverrideCount = useStore(selectActiveOverrideCount);
	const resetAllOverrides = useStore((s) => s.resetAllOverrides);
	const addTemporaryAccount = useStore((s) => s.addTemporaryAccount);
	const removeTemporaryAccount = useStore((s) => s.removeTemporaryAccount);
	const addTemporaryPosting = useStore((s) => s.addTemporaryPosting);
	const removeTemporaryPosting = useStore((s) => s.removeTemporaryPosting);
	const addTemporaryCheckpoint = useStore((s) => s.addTemporaryCheckpoint);
	const removeTemporaryCheckpoint = useStore(
		(s) => s.removeTemporaryCheckpoint,
	);

	return (
		<Collapsible autoOpenWhen={activeOverrideCount > 0}>
			<Collapsible.Trigger>
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-start gap-3">
						<Collapsible.Chevron />
						<div>
							<div className="type-title text-base">Scenario overrides</div>
							<div className="type-muted">
								{activeOverrideCount > 0
									? `${activeOverrideCount} temporary change${activeOverrideCount === 1 ? "" : "s"} active.`
									: "Temporarily add trial accounts, scheduled transactions, and balance checkpoints."}
							</div>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{activeOverrideCount > 0 ? (
							<StatusPill>{activeOverrideCount} active</StatusPill>
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
							onClick={resetAllOverrides}
							disabled={activeOverrideCount === 0}
						>
							Reset all overrides
						</Button>
					</div>

					<div className="space-y-3">
						<h3 className="type-body type-value font-semibold/80">
							Temporary additions
						</h3>

						<WhatIfAccountForm
							accounts={whatIfState.addedAccounts}
							onAdd={addTemporaryAccount}
							onRemove={removeTemporaryAccount}
						/>

						<WhatIfPostingForm
							postings={whatIfState.addedPostings}
							pack={pack}
							onAdd={addTemporaryPosting}
							onRemove={removeTemporaryPosting}
						/>

						<WhatIfCheckpointForm
							checkpoints={whatIfState.addedCheckpoints}
							onAdd={addTemporaryCheckpoint}
							onRemove={removeTemporaryCheckpoint}
						/>
					</div>
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}
