import type { ScenarioPack } from "@/lib/projection";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useShallow } from "zustand/shallow";
import { useStore, selectActiveOverrideCount } from "@/store";
import { WhatIfAccountForm } from "@/components/dashboard/what-if/WhatIfAccountForm";
import { WhatIfPostingForm } from "@/components/dashboard/what-if/WhatIfPostingForm";
import { WhatIfCheckpointForm } from "@/components/dashboard/what-if/WhatIfCheckpointForm";

interface ContributionWhatIfControlsProps {
  pack: ScenarioPack;
}

export function ContributionWhatIfControls({
  pack,
}: ContributionWhatIfControlsProps) {
  const whatIfState = useStore(useShallow((s) => ({
    addedAccounts: s.addedAccounts,
    addedPostings: s.addedPostings,
    addedCheckpoints: s.addedCheckpoints,
  })));
  const activeOverrideCount = useStore(selectActiveOverrideCount);
  const resetAllOverrides = useStore((s) => s.resetAllOverrides);
  const addTemporaryAccount = useStore((s) => s.addTemporaryAccount);
  const removeTemporaryAccount = useStore((s) => s.removeTemporaryAccount);
  const addTemporaryPosting = useStore((s) => s.addTemporaryPosting);
  const removeTemporaryPosting = useStore((s) => s.removeTemporaryPosting);
  const addTemporaryCheckpoint = useStore((s) => s.addTemporaryCheckpoint);
  const removeTemporaryCheckpoint = useStore((s) => s.removeTemporaryCheckpoint);

  return (
    <CollapsibleSection
      open={activeOverrideCount > 0}
      title="Scenario overrides"
      description={activeOverrideCount > 0
        ? `${activeOverrideCount} temporary change${activeOverrideCount === 1 ? "" : "s"} active.`
          : `Temporarily add trial accounts, scheduled transactions, and balance checkpoints.`}
      badge={activeOverrideCount > 0 ? `${activeOverrideCount} active` : undefined}
    >
      <div className="mt-5 space-y-6">
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={resetAllOverrides} disabled={activeOverrideCount === 0}>
            Reset all overrides
          </Button>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Temporary additions</h3>

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
    </CollapsibleSection>
  );
}
