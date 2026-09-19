import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { TemporaryAccountForm } from "@/components/dashboard/current-changes/TemporaryAccountForm";
import { TemporaryPostingForm } from "@/components/dashboard/current-changes/TemporaryPostingForm";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { StatusPill } from "@/components/ui/status-pill";
import type {
	Account,
	FinancialModelDocument,
	Posting,
} from "@/lib/projection";
import { useModelRuntime } from "@/runtime/modelRuntime";
import {
	selectCurrentChangeCount,
	selectEditorActions,
	selectEditorState,
	useStore,
} from "@/store";

interface CurrentChangesControlsProps {
	document: FinancialModelDocument;
}

export function CurrentChangesControls({
	document,
}: CurrentChangesControlsProps) {
	const { isEditing, isDirty, workingDocument, editingBaseline } = useStore(
		useShallow(selectEditorState),
	);
	const {
		startEditing,
		cancelEditing,
		addAccount,
		deleteAccount,
		updateAccount,
		addPosting,
		deletePosting,
		updatePosting,
	} = useStore(useShallow(selectEditorActions));
	const { save, isSaving, source } = useModelRuntime();
	const currentChangeCount = useStore(selectCurrentChangeCount);

	const baseline = editingBaseline ?? document;
	const draft = workingDocument;
	const baselineAccountIds = useMemo(
		() => new Set(baseline.accounts.map((account) => account.id)),
		[baseline],
	);
	const baselinePostingIds = useMemo(
		() => new Set(baseline.postings.map((posting) => posting.id)),
		[baseline],
	);
	const draftAccounts = draft?.accounts ?? [];
	const draftPostings = draft?.postings ?? [];
	const addedAccounts = useMemo(
		() =>
			draft
				? draftAccounts.filter((account) => !baselineAccountIds.has(account.id))
				: [],
		[draft, draftAccounts, baselineAccountIds],
	);
	const addedPostings = useMemo(
		() =>
			draft
				? draftPostings.filter((posting) => !baselinePostingIds.has(posting.id))
				: [],
		[draft, draftPostings, baselinePostingIds],
	);
	const disabledAccounts = useMemo(
		() => (draft ? draftAccounts.filter((account) => !account.enabled) : []),
		[draft, draftAccounts],
	);
	const disabledPostings = useMemo(
		() => (draft ? draftPostings.filter((posting) => !posting.enabled) : []),
		[draft, draftPostings],
	);
	// Rows available for quick-exclude: enabled rows in the draft when editing,
	// otherwise enabled baseline rows (excluding starts an edit session).
	const excludableAccounts = (draft ?? baseline).accounts.filter(
		(account) => account.enabled,
	);
	const excludablePostings = (draft ?? baseline).postings.filter(
		(posting) => posting.enabled,
	);
	const routeDocument = draft ?? document;

	const ensureEditing = () => {
		if (!isEditing) {
			startEditing(document);
		}
	};
	const handleAddAccount = (account: Account) => {
		ensureEditing();
		addAccount(account);
	};
	const handleAddPosting = (posting: Posting) => {
		ensureEditing();
		addPosting(posting);
	};
	const handleExcludeAccount = (id: string) => {
		ensureEditing();
		updateAccount(id, { enabled: false });
	};
	const handleExcludePosting = (id: string) => {
		ensureEditing();
		updatePosting(id, { enabled: false });
	};

	return (
		<Collapsible autoOpenWhen={currentChangeCount > 0}>
			<Collapsible.Trigger>
				<Collapsible.Header
					title="Draft changes"
					description={
						currentChangeCount > 0
							? `${currentChangeCount} unsaved change${currentChangeCount === 1 ? "" : "s"} in the draft.`
							: "Stage trial accounts and scheduled transactions in the draft."
					}
					trailing={
						<div className="flex items-center gap-2">
							{currentChangeCount > 0 ? (
								<StatusPill>{currentChangeCount} unsaved</StatusPill>
							) : null}
							<span className="type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70">
								Show details
							</span>
						</div>
					}
				/>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<div className="space-y-6">
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={cancelEditing}
							disabled={!isEditing}
						>
							Discard draft
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={save}
							disabled={!isEditing || !isDirty || !source.saveLabel || isSaving}
						>
							{isSaving
								? "Saving..."
								: (source.saveLabel ?? "Save unavailable")}
						</Button>
					</div>

					{disabledAccounts.length > 0 || disabledPostings.length > 0 ? (
						<div className="space-y-3">
							<h3 className="type-body type-value font-semibold/80">
								Excluded from this scenario
							</h3>
							{disabledAccounts.map((account) => (
								<DraftRowItem
									key={`excluded-account-${account.id}`}
									label={account.label}
									type="Account"
									actionLabel="Restore"
									onAction={() => updateAccount(account.id, { enabled: true })}
								/>
							))}
							{disabledPostings.map((posting) => (
								<DraftRowItem
									key={`excluded-posting-${posting.id}`}
									label={posting.label}
									type="Transaction"
									actionLabel="Restore"
									onAction={() => updatePosting(posting.id, { enabled: true })}
								/>
							))}
						</div>
					) : null}

					<div className="space-y-3">
						<h3 className="type-body type-value font-semibold/80">
							Quick-exclude baseline rows
						</h3>
						<p className="type-caption text-muted-foreground">
							Excluding a row sets enabled=false on the draft row
							{isEditing
								? "."
								: " and starts a draft edit session when needed."}
						</p>
						{excludableAccounts.map((account) => (
							<DraftRowItem
								key={`excludable-account-${account.id}`}
								label={account.label}
								type="Account"
								actionLabel="Exclude"
								onAction={() => handleExcludeAccount(account.id)}
							/>
						))}
						{excludablePostings.map((posting) => (
							<DraftRowItem
								key={`excludable-posting-${posting.id}`}
								label={posting.label}
								type="Transaction"
								actionLabel="Exclude"
								onAction={() => handleExcludePosting(posting.id)}
							/>
						))}
						{excludableAccounts.length === 0 &&
						excludablePostings.length === 0 ? (
							<p className="type-caption text-muted-foreground">
								Every row is already excluded or removed.
							</p>
						) : null}
					</div>

					<div className="space-y-3">
						<h3 className="type-body type-value font-semibold/80">
							Draft additions
						</h3>

						<TemporaryAccountForm
							accounts={addedAccounts}
							reservedIds={[
								...routeDocument.accounts.map((account) => account.id),
								...routeDocument.postings.map((posting) => posting.id),
							]}
							onAdd={handleAddAccount}
							onRemove={deleteAccount}
						/>

						<TemporaryPostingForm
							postings={addedPostings}
							document={routeDocument}
							reservedIds={[
								...routeDocument.accounts.map((account) => account.id),
								...routeDocument.postings.map((posting) => posting.id),
							]}
							onAdd={handleAddPosting}
							onRemove={deletePosting}
						/>
					</div>
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}

function DraftRowItem({
	label,
	type,
	actionLabel,
	onAction,
}: {
	label: string;
	type: string;
	actionLabel: "Restore" | "Exclude";
	onAction: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface/60 px-4 py-2">
			<div>
				<div className="type-label">{label}</div>
				<div className="type-caption">{type}</div>
			</div>
			<Button type="button" variant="ghost" size="sm" onClick={onAction}>
				{actionLabel}
			</Button>
		</div>
	);
}
