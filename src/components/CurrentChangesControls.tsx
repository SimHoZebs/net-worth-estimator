import { useShallow } from "zustand/shallow";
import { TemporaryAccountForm } from "@/components/dashboard/current-changes/TemporaryAccountForm";
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
			disabledAccountIds: s.disabledAccountIds,
			disabledPostingIds: s.disabledPostingIds,
		})),
	);
	const currentChangeCount = useStore(selectCurrentChangeCount);
	const resetCurrentChanges = useStore((s) => s.resetCurrentChanges);
	const addTemporaryAccount = useStore((s) => s.addTemporaryAccount);
	const removeTemporaryAccount = useStore((s) => s.removeTemporaryAccount);
	const addTemporaryPosting = useStore((s) => s.addTemporaryPosting);
	const removeTemporaryPosting = useStore((s) => s.removeTemporaryPosting);
	const toggleAccountDisabled = useStore((s) => s.toggleAccountDisabled);
	const togglePostingDisabled = useStore((s) => s.togglePostingDisabled);
	const accountById = new Map(
		document.accounts.map((account) => [account.id, account]),
	);
	const postingById = new Map(
		document.postings.map((posting) => [posting.id, posting]),
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
									: "Temporarily add trial accounts and scheduled transactions."}
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

					{currentChanges.disabledAccountIds.length > 0 ||
					currentChanges.disabledPostingIds.length > 0 ? (
						<div className="space-y-3">
							<h3 className="type-body type-value font-semibold/80">
								Excluded from this scenario
							</h3>
							{currentChanges.disabledAccountIds.map((id) => (
								<ExcludedItem
									key={`excluded-account-${id}`}
									label={accountById.get(id)?.label ?? id}
									type="Account"
									onRestore={() => toggleAccountDisabled(id)}
								/>
							))}
							{currentChanges.disabledPostingIds.map((id) => (
								<ExcludedItem
									key={`excluded-posting-${id}`}
									label={postingById.get(id)?.label ?? id}
									type="Transaction"
									onRestore={() => togglePostingDisabled(id)}
								/>
							))}
						</div>
					) : null}

					<div className="space-y-3">
						<h3 className="type-body type-value font-semibold/80">
							Temporary additions
						</h3>

						<TemporaryAccountForm
							accounts={currentChanges.addedAccounts}
							reservedIds={[
								...document.accounts.map((account) => account.id),
								...document.postings.map((posting) => posting.id),
								...currentChanges.addedPostings.map((posting) => posting.id),
							]}
							onAdd={addTemporaryAccount}
							onRemove={removeTemporaryAccount}
						/>

						<TemporaryPostingForm
							postings={currentChanges.addedPostings}
							document={document}
							reservedIds={[
								...document.accounts.map((account) => account.id),
								...currentChanges.addedAccounts.map((account) => account.id),
							]}
							onAdd={addTemporaryPosting}
							onRemove={removeTemporaryPosting}
						/>
					</div>
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}

function ExcludedItem({
	label,
	type,
	onRestore,
}: {
	label: string;
	type: string;
	onRestore: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface/60 px-4 py-2">
			<div>
				<div className="type-label">{label}</div>
				<div className="type-caption">{type}</div>
			</div>
			<Button type="button" variant="ghost" size="sm" onClick={onRestore}>
				Restore
			</Button>
		</div>
	);
}
