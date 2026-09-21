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
import { partitionPostings } from "@/lib/posting-categories";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useProjectionArtifacts } from "@/runtime/projectionRuntime";
import { selectEditorActions, selectEditorState, useStore } from "@/store";
import { ModelValidationPanel } from "./ModelValidationPanel";

type ReadInputTab = "scheduled" | "accounts" | "history" | "checkpoints";
type EditInputTab = "postings" | "accounts" | "checkpoints";

function tabClassName(isActive: boolean) {
	return `rounded-full px-3 py-1.5 type-caption font-medium transition ${
		isActive
			? "bg-primary  text-primary-foreground shadow-sm "
			: "border border-border/80 bg-card/85 text-muted-foreground hover:border-ring hover:text-foreground dark:border-white/10"
	}`;
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

	const [showAdvanced, setShowAdvanced] = useState(false);
	const [readTab, setReadTab] = useState<ReadInputTab>("accounts");
	const [editTab, setEditTab] = useState<EditInputTab>("postings");

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

	const tabs = isEditing
		? [
				{
					id: "postings" as const,
					label: "Posting definitions",
					count: displayDocument?.postings.length ?? 0,
				},
				{
					id: "accounts" as const,
					label: "Accounts",
					count: displayDocument?.accounts.length ?? 0,
				},
				{
					id: "checkpoints" as const,
					label: "Balance checkpoints",
					count: displayDocument?.checkpoints.length ?? 0,
				},
			]
		: [
				{
					id: "accounts" as const,
					label: "Current position",
					count: displayDocument?.accounts.length ?? 0,
				},
				{
					id: "scheduled" as const,
					label: "Scheduled transactions",
					count: postingGroups.scheduledTransactions.length,
				},
				{
					id: "history" as const,
					label: "Transaction history",
					count: postingGroups.transactionHistory.length,
				},
				{
					id: "checkpoints" as const,
					label: "Balance checkpoints",
					count: displayDocument?.checkpoints.length ?? 0,
				},
			];
	const activeTab = isEditing ? editTab : readTab;

	return (
		<SectionCard
			description={
				<>
					Posting-derived projection inputs and observed account balances.
					Validation: {validationSummary}.
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
									Edit baseline
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

			{issues.length > 0 ? <ModelValidationPanel issues={issues} /> : null}

			{document && displayDocument ? (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<fieldset className="flex flex-wrap gap-2">
							<legend className="sr-only">Model input sections</legend>
							{tabs.map((tab) => (
								<button
									key={tab.id}
									type="button"
									aria-pressed={activeTab === tab.id}
									onClick={() =>
										isEditing
											? setEditTab(tab.id as EditInputTab)
											: setReadTab(tab.id as ReadInputTab)
									}
									className={tabClassName(activeTab === tab.id)}
								>
									{tab.label} <span className="opacity-70">{tab.count}</span>
								</button>
							))}
						</fieldset>

						{!isEditing ? (
							<button
								type="button"
								onClick={() => setShowAdvanced(!showAdvanced)}
								className="rounded-lg border border-border px-3 py-1.5 type-label transition hover:border-ring hover:text-foreground"
							>
								{showAdvanced
									? "Hide technical fields"
									: "Show technical fields"}
							</button>
						) : null}
					</div>

					<div className="space-y-4">
						{isEditing && activeTab === "postings" ? (
							<PostingsTable
								editable
								displayDocument={displayDocument}
								document={document}
								isDirty={isDirty}
								workingDocument={workingDocument}
								projectionStartDate={projectionStartDate}
								updatePosting={updatePosting}
								deletePosting={deletePosting}
								addPosting={addPosting}
							/>
						) : null}

						{!isEditing && activeTab === "scheduled" ? (
							<PostingsTable
								postings={postingGroups.scheduledTransactions}
								accounts={displayDocument.accounts}
								projectionStartDate={projectionStartDate}
								showAdvanced={showAdvanced}
							/>
						) : null}

						{activeTab === "accounts" ? (
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
							)
						) : null}

						{!isEditing && activeTab === "history" ? (
							<TransactionHistoryTable
								postings={postingGroups.transactionHistory}
								accounts={displayDocument.accounts}
							/>
						) : null}

						{activeTab === "checkpoints" ? (
							isEditing ? (
								<CheckpointsTable
									editable
									displayDocument={displayDocument}
									projectionStartDate={projectionStartDate}
									updateCheckpoint={updateCheckpoint}
									deleteCheckpoint={deleteCheckpoint}
									addCheckpoint={addCheckpoint}
								/>
							) : (
								<CheckpointsTable
									checkpoints={displayDocument.checkpoints}
									showAdvanced={showAdvanced}
									accountLabelById={accountLabelById}
								/>
							)
						) : null}
					</div>
				</>
			) : (
				<EmptyState className="bg-surface/70 px-4 py-8 text-center dark:border-white/10 dark:bg-surface/50">
					No financial model loaded yet.
				</EmptyState>
			)}

			{document ? (
				<div className="border-t border-border/70 pt-5">
					<CurrentChangesControls document={document} />
				</div>
			) : null}
		</SectionCard>
	);
}
