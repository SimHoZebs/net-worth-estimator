import { useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { CurrentChangesControls } from "@/components/CurrentChangesControls";
import { AccountsTable } from "@/components/dashboard/tables/AccountsTable";
import { CheckpointsTable } from "@/components/dashboard/tables/CheckpointsTable";
import { PostingsTable } from "@/components/dashboard/tables/PostingsTable";
import { TransactionHistoryTable } from "@/components/dashboard/tables/TransactionHistoryTable";
import { EmptyState, SectionCard } from "@/components/present/present";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/format";
import {
	associatedAccountIds,
	partitionPostings,
} from "@/lib/posting-categories";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useProjectionArtifacts } from "@/runtime/projectionRuntime";
import {
	selectCurrentChangeCount,
	selectEditorActions,
	selectEditorState,
	useStore,
} from "@/store";
import { ModelValidationPanel } from "./ModelValidationPanel";

type InputSection = "accounts" | "scheduled" | "activity" | "reconcile";

function tabClassName(isActive: boolean) {
	return `rounded-full px-3 py-1.5 type-caption font-medium transition ${
		isActive
			? "bg-primary  text-primary-foreground shadow-sm "
			: "border border-border/80 bg-card/85 text-muted-foreground hover:border-ring hover:text-foreground dark:border-white/10"
	}`;
}

function postingTouchesAccount(
	posting: Parameters<typeof associatedAccountIds>[0],
	accountId: string,
	accountIds: ReadonlySet<string>,
) {
	return associatedAccountIds(posting, accountIds).includes(accountId);
}

export function ModelInputsInspector() {
	const {
		document,
		issues,
		source,
		isLoading,
		loadError,
		sourceActionError,
		projectionStartDate,
		isSaving,
		dataUpdatedAt,
		reload,
		save,
	} = useModelRuntime();
	const { result, projectionResultIsStale } = useProjectionArtifacts();
	const { isEditing, isDirty, workingDocument } = useStore(
		useShallow(selectEditorState),
	);
	const {
		startEditing,
		cancelEditing,
		updateAccount,
		deleteAccount,
		addAccount,
		updatePosting,
		deletePosting,
		addPosting,
		addCheckpoint,
		deleteCheckpoint,
		updateCheckpoint,
	} = useStore(useShallow(selectEditorActions));
	const currentChangeCount = useStore(selectCurrentChangeCount);

	const [showAdvanced, setShowAdvanced] = useState(false);
	const [activeSection, setActiveSection] = useState<InputSection>("accounts");
	const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
		null,
	);
	const [selectedPostingId, setSelectedPostingId] = useState<string | null>(
		null,
	);
	const [showPending, setShowPending] = useState(false);

	const readDocument = useMemo(() => {
		if (!document) return null;
		return {
			...document,
			accounts: document.accounts.filter((account) => account.enabled),
			postings: document.postings.filter((posting) => posting.enabled),
		};
	}, [document]);
	const displayDocument =
		isEditing && workingDocument ? workingDocument : readDocument;
	const postingGroups = useMemo(
		() => partitionPostings(displayDocument?.postings ?? []),
		[displayDocument?.postings],
	);
	const accountLabelById = useMemo(
		() =>
			new Map(
				displayDocument?.accounts.map((account) => [
					account.id,
					account.label,
				]) ?? [],
			),
		[displayDocument?.accounts],
	);

	const scheduledPostings = useMemo(() => {
		if (!selectedAccountId || !displayDocument)
			return postingGroups.scheduledTransactions;
		const accountIds = new Set(displayDocument.accounts.map((a) => a.id));
		return postingGroups.scheduledTransactions.filter((posting) =>
			postingTouchesAccount(posting, selectedAccountId, accountIds),
		);
	}, [postingGroups.scheduledTransactions, selectedAccountId, displayDocument]);
	const historyPostings = useMemo(() => {
		if (!selectedAccountId || !displayDocument)
			return postingGroups.transactionHistory;
		const accountIds = new Set(displayDocument.accounts.map((a) => a.id));
		return postingGroups.transactionHistory.filter((posting) =>
			postingTouchesAccount(posting, selectedAccountId, accountIds),
		);
	}, [postingGroups.transactionHistory, selectedAccountId, displayDocument]);
	const visibleRules = useMemo(() => {
		if (!selectedAccountId || !displayDocument)
			return postingGroups.accountRules;
		const accountIds = new Set(displayDocument.accounts.map((a) => a.id));
		return postingGroups.accountRules.filter((posting) =>
			postingTouchesAccount(posting, selectedAccountId, accountIds),
		);
	}, [postingGroups.accountRules, selectedAccountId, displayDocument]);
	const visibleCheckpoints = useMemo(
		() =>
			selectedAccountId
				? (displayDocument?.checkpoints.filter(
						(checkpoint) => checkpoint.AccountId === selectedAccountId,
					) ?? [])
				: (displayDocument?.checkpoints ?? []),
		[displayDocument?.checkpoints, selectedAccountId],
	);
	const visibleIssues = useMemo(
		() =>
			selectedAccountId
				? issues.filter((issue) => issue.path.includes(selectedAccountId))
				: issues,
		[issues, selectedAccountId],
	);
	// Header summary and tab counts stay unfiltered so the account filter can
	// never hide a diagnostic or misstate a count. The filter applies only to
	// the lists below, each of which labels the active filter.
	const errorCount = issues.filter(
		(issue) => issue.severity === "error",
	).length;
	const warningCount = issues.filter(
		(issue) => issue.severity === "warning",
	).length;
	const validationSummary =
		errorCount > 0
			? pluralize(errorCount, "error")
			: warningCount > 0
				? pluralize(warningCount, "warning")
				: document
					? "Clean"
					: "Pending";

	const ensureEditing = () => {
		if (!isEditing && document) startEditing(document);
	};

	const tabs: { id: InputSection; label: string; count: number }[] = [
		{
			id: "accounts",
			label: "Accounts",
			count: displayDocument?.accounts.length ?? 0,
		},
		{
			id: "scheduled",
			label: "Scheduled",
			count: isEditing
				? (displayDocument?.postings.length ?? 0)
				: scheduledPostings.length,
		},
		{
			id: "activity",
			label: "Activity",
			count: isEditing
				? (displayDocument?.postings.length ?? 0)
				: historyPostings.length,
		},
		{
			id: "reconcile",
			label: "Reconcile",
			count: displayDocument?.checkpoints.length ?? 0,
		},
	];

	// Edit mode always edits the full posting/checkpoint collections so no
	// partition (scheduled, rules, history) can vanish and newly added rows
	// stay visible. The account filter is a read-view aid only.
	const sectionDocument = displayDocument;

	const lastLoaded =
		dataUpdatedAt === 0
			? "Not loaded"
			: new Date(dataUpdatedAt).toLocaleString();

	return (
		<SectionCard
			description={
				<>
					What the model thinks you have, and whether it is right. Validation:{" "}
					{validationSummary}.
				</>
			}
			action={
				<div className="flex flex-wrap justify-end gap-2">
					{isEditing ? (
						<>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={cancelEditing}
							>
								Cancel
							</Button>
							<Button
								type="button"
								size="sm"
								onClick={save}
								disabled={!isDirty || !source.saveLabel || isSaving}
							>
								{isSaving
									? "Saving..."
									: (source.saveLabel ?? "Save unavailable")}
							</Button>
						</>
					) : (
						<>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={reload}
								disabled={isLoading}
							>
								{isLoading ? "Loading..." : "Reload"}
							</Button>
							{document && source.saveLabel ? (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => startEditing(document)}
								>
									Manage
								</Button>
							) : null}
						</>
					)}
				</div>
			}
			className="rounded-[1.8rem] border-border/80"
			contentClassName="space-y-5"
		>
			{loadError ? (
				<Alert variant="destructive" className="rounded-[1.6rem]">
					<AlertTitle>Financial model could not be loaded</AlertTitle>
					<AlertDescription>{loadError}</AlertDescription>
				</Alert>
			) : null}

			{sourceActionError ? (
				<Alert variant="destructive" className="rounded-[1.6rem]">
					<AlertTitle>Source action failed</AlertTitle>
					<AlertDescription>{sourceActionError}</AlertDescription>
				</Alert>
			) : null}

			<div className="flex flex-wrap items-center justify-between gap-2 type-caption text-muted-foreground">
				<span>
					{source.label} · Last loaded {lastLoaded}
				</span>
				{!isEditing ? (
					<button
						type="button"
						onClick={() => setShowAdvanced(!showAdvanced)}
						className="rounded-lg border border-border px-3 py-1.5 type-label transition hover:border-ring hover:text-foreground"
					>
						{showAdvanced ? "Hide details" : "Show details"}
					</button>
				) : null}
			</div>

			{document && displayDocument ? (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<fieldset className="flex flex-wrap gap-2">
							<legend className="sr-only">Model input sections</legend>
							{tabs.map((tab) => (
								<button
									key={tab.id}
									type="button"
									aria-pressed={activeSection === tab.id}
									onClick={() => {
										setActiveSection(tab.id);
										setSelectedPostingId(null);
									}}
									className={tabClassName(activeSection === tab.id)}
								>
									{tab.label} <span className="opacity-70">{tab.count}</span>
								</button>
							))}
						</fieldset>
					</div>

					<AccountContextBar
						accounts={displayDocument.accounts}
						selectedAccountId={selectedAccountId}
						onSelect={setSelectedAccountId}
						onExclude={(id) => {
							ensureEditing();
							updateAccount(id, { enabled: false });
						}}
					/>

					<div className="space-y-4">
						{activeSection === "accounts" ? (
							isEditing ? (
								<AccountsTable
									editable
									displayDocument={displayDocument}
									document={document}
									isDirty={isDirty}
									workingDocument={workingDocument}
									updateAccount={updateAccount}
									deleteAccount={deleteAccount}
									addAccount={addAccount}
								/>
							) : (
								<>
									{visibleRules.length !== postingGroups.accountRules.length ? (
										<FilterNotice
											text={`Rule exclude list filtered by ${accountLabelById.get(selectedAccountId ?? "") ?? selectedAccountId} · ${visibleRules.length} of ${postingGroups.accountRules.length}`}
											onClear={() => setSelectedAccountId(null)}
										/>
									) : null}
									<AccountsTable
										accounts={displayDocument.accounts}
										accountRules={postingGroups.accountRules}
										accountSummaries={result?.accountSummaries ?? null}
										currentNetWorth={result?.summary.currentNetWorth ?? null}
										projectionStartDate={
											result?.milestones.projectionStartDate ??
											projectionStartDate
										}
										balancesAreStale={projectionResultIsStale}
										showAdvanced={showAdvanced}
									/>
									<PostingExcludeBar
										label="Trial exclude rule"
										postings={visibleRules}
										selectedPostingId={selectedPostingId}
										onSelect={setSelectedPostingId}
										onExclude={(id) => {
											ensureEditing();
											updatePosting(id, { enabled: false });
										}}
									/>
								</>
							)
						) : null}

						{activeSection === "scheduled" ? (
							isEditing && sectionDocument ? (
								<>
									<p className="type-caption text-muted-foreground">
										Editing all posting definitions (scheduled, rules, and
										history) so no rule can hide in this mode.
									</p>
									<PostingsTable
										editable
										displayDocument={sectionDocument}
										document={document}
										isDirty={isDirty}
										workingDocument={workingDocument}
										projectionStartDate={projectionStartDate}
										updatePosting={updatePosting}
										deletePosting={deletePosting}
										addPosting={addPosting}
									/>
								</>
							) : (
								<>
									{selectedAccountId ? (
										<FilterNotice
											text={`Filtered by ${accountLabelById.get(selectedAccountId) ?? selectedAccountId} · ${scheduledPostings.length} of ${postingGroups.scheduledTransactions.length}`}
											onClear={() => setSelectedAccountId(null)}
										/>
									) : null}
									<PostingExcludeBar
										postings={scheduledPostings}
										selectedPostingId={selectedPostingId}
										onSelect={setSelectedPostingId}
										onExclude={(id) => {
											ensureEditing();
											updatePosting(id, { enabled: false });
										}}
									/>
									<PostingsTable
										postings={scheduledPostings}
										accounts={displayDocument.accounts}
										projectionStartDate={projectionStartDate}
										showAdvanced={showAdvanced}
									/>
								</>
							)
						) : null}

						{activeSection === "activity" ? (
							isEditing && sectionDocument ? (
								<>
									<p className="type-caption text-muted-foreground">
										Editing all posting definitions (scheduled, rules, and
										history) so no rule can hide in this mode.
									</p>
									<PostingsTable
										editable
										displayDocument={sectionDocument}
										document={document}
										isDirty={isDirty}
										workingDocument={workingDocument}
										projectionStartDate={projectionStartDate}
										updatePosting={updatePosting}
										deletePosting={deletePosting}
										addPosting={addPosting}
									/>
								</>
							) : (
								<>
									{selectedAccountId ? (
										<FilterNotice
											text={`Filtered by ${accountLabelById.get(selectedAccountId) ?? selectedAccountId} · ${historyPostings.length} of ${postingGroups.transactionHistory.length}`}
											onClear={() => setSelectedAccountId(null)}
										/>
									) : null}
									<PostingExcludeBar
										postings={historyPostings}
										selectedPostingId={selectedPostingId}
										onSelect={setSelectedPostingId}
										onExclude={(id) => {
											ensureEditing();
											updatePosting(id, { enabled: false });
										}}
									/>
									<TransactionHistoryTable
										postings={historyPostings}
										accounts={displayDocument.accounts}
									/>
								</>
							)
						) : null}

						{activeSection === "reconcile" ? (
							<div className="space-y-4">
								{selectedAccountId ? (
									<FilterNotice
										text={`Reconcile filtered by ${accountLabelById.get(selectedAccountId) ?? selectedAccountId} · ${visibleCheckpoints.length} of ${displayDocument.checkpoints.length} checkpoints, ${visibleIssues.length} of ${issues.length} diagnostics`}
										onClear={() => setSelectedAccountId(null)}
									/>
								) : null}
								{visibleIssues.length > 0 ? (
									<ModelValidationPanel issues={visibleIssues} />
								) : selectedAccountId ? (
									<p className="type-caption text-muted-foreground">
										No diagnostics mention this account. Unfiltered validation:{" "}
										{validationSummary}.
									</p>
								) : null}
								{isEditing ? (
									<>
										{selectedAccountId ? (
											<p className="type-caption text-muted-foreground">
												Editing all checkpoints; the account filter applies to
												the read view only.
											</p>
										) : null}
										<CheckpointsTable
											editable
											displayDocument={displayDocument}
											projectionStartDate={projectionStartDate}
											updateCheckpoint={updateCheckpoint}
											deleteCheckpoint={deleteCheckpoint}
											addCheckpoint={addCheckpoint}
										/>
									</>
								) : (
									<CheckpointsTable
										checkpoints={visibleCheckpoints}
										showAdvanced={showAdvanced}
										accountLabelById={accountLabelById}
									/>
								)}
							</div>
						) : null}
					</div>
				</>
			) : (
				<EmptyState className="bg-surface/70 px-4 py-8 text-center dark:border-white/10 dark:bg-surface/50">
					No financial model loaded yet.
				</EmptyState>
			)}

			{document ? (
				<div className="space-y-3">
					{(currentChangeCount > 0 || isEditing) && !showPending ? (
						<div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
							<span className="type-caption">
								{currentChangeCount > 0
									? `${currentChangeCount} unsaved change${currentChangeCount === 1 ? "" : "s"} in the draft.`
									: "Editing baseline. Trial changes stage here."}
							</span>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => setShowPending(true)}
								>
									Review changes
								</Button>
								<Button
									type="button"
									size="sm"
									onClick={save}
									disabled={!isDirty || !source.saveLabel || isSaving}
								>
									{isSaving
										? "Saving..."
										: (source.saveLabel ?? "Save unavailable")}
								</Button>
							</div>
						</div>
					) : null}
					{showPending || currentChangeCount > 0 ? (
						<div className="border-t border-border/70 pt-5">
							{showPending || currentChangeCount > 0 ? (
								<div className="mb-3 flex justify-end">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => setShowPending(!showPending)}
									>
										{showPending
											? "Hide pending changes"
											: "Show pending changes"}
									</Button>
								</div>
							) : null}
							{showPending || currentChangeCount > 0 ? (
								<CurrentChangesControls document={document} />
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</SectionCard>
	);
}

function AccountContextBar({
	accounts,
	selectedAccountId,
	onSelect,
	onExclude,
}: {
	accounts: { id: string; label: string; enabled: boolean }[];
	selectedAccountId: string | null;
	onSelect: (id: string | null) => void;
	onExclude: (id: string) => void;
}) {
	const selected = accounts.find((account) => account.id === selectedAccountId);
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-surface/55 px-3 py-2">
			<label className="type-caption" htmlFor="account-context">
				Account
			</label>
			<select
				id="account-context"
				className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 type-caption sm:max-w-xs"
				value={selectedAccountId ?? ""}
				onChange={(event) => onSelect(event.target.value || null)}
			>
				<option value="">All accounts</option>
				{accounts.map((account) => (
					<option key={account.id} value={account.id}>
						{account.label}
					</option>
				))}
			</select>
			{selected ? (
				<>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onExclude(selected.id)}
					>
						Exclude {selected.label}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onSelect(null)}
					>
						Clear
					</Button>
				</>
			) : null}
		</div>
	);
}

function FilterNotice({
	text,
	onClear,
}: {
	text: string;
	onClear: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-surface/55 px-3 py-2 type-caption text-muted-foreground">
			<span>{text}</span>
			<Button type="button" variant="ghost" size="sm" onClick={onClear}>
				Clear filter
			</Button>
		</div>
	);
}

function PostingExcludeBar({
	postings,
	selectedPostingId,
	onSelect,
	onExclude,
	label = "Trial exclude",
}: {
	postings: { id: string; label: string }[];
	selectedPostingId: string | null;
	onSelect: (id: string | null) => void;
	onExclude: (id: string) => void;
	label?: string;
}) {
	if (postings.length === 0) return null;
	const selected = postings.find((posting) => posting.id === selectedPostingId);
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-surface/55 px-3 py-2">
			<label className="type-caption" htmlFor="posting-exclude">
				{label}
			</label>
			<select
				id="posting-exclude"
				className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 type-caption sm:max-w-xs"
				value={selectedPostingId ?? ""}
				onChange={(event) => onSelect(event.target.value || null)}
			>
				<option value="">Select a transaction…</option>
				{postings.map((posting) => (
					<option key={posting.id} value={posting.id}>
						{posting.label}
					</option>
				))}
			</select>
			{selected ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onExclude(selected.id)}
				>
					Exclude
				</Button>
			) : null}
		</div>
	);
}
