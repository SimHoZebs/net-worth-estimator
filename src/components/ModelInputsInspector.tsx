import { useState } from "react";
import { useShallow } from "zustand/shallow";
import { CurrentChangesControls } from "@/components/CurrentChangesControls";
import { EditableAccountsTable } from "@/components/dashboard/tables/EditableAccountsTable";
import { EditableCheckpointsTable } from "@/components/dashboard/tables/EditableCheckpointsTable";
import { EditablePostingsTable } from "@/components/dashboard/tables/EditablePostingsTable";
import { ReadOnlyAccountsTable } from "@/components/dashboard/tables/ReadOnlyAccountsTable";
import { ReadOnlyCheckpointsTable } from "@/components/dashboard/tables/ReadOnlyCheckpointsTable";
import { ReadOnlyPostingsTable } from "@/components/dashboard/tables/ReadOnlyPostingsTable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { pluralize } from "@/lib/format";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { selectEditorActions, selectEditorState, useStore } from "@/store";
import { ModelValidationPanel } from "./ModelValidationPanel";

type InputTab = "postings" | "accounts" | "history";

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
	const disabledAccountIds = useStore((s) => s.disabledAccountIds);
	const disabledPostingIds = useStore((s) => s.disabledPostingIds);
	const toggleAccountDisabled = useStore((s) => s.toggleAccountDisabled);
	const togglePostingDisabled = useStore((s) => s.togglePostingDisabled);
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
	const [activeTab, setActiveTab] = useState<InputTab>("postings");

	const disabledAccountSet = new Set(disabledAccountIds);
	const disabledPostingSet = new Set(disabledPostingIds);
	const displayDocument =
		isEditing && workingDocument ? workingDocument : document;
	const accountLabelById = new Map(
		displayDocument?.accounts.map((account) => [account.id, account.label]) ??
			[],
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

	const tabs: Array<{ id: InputTab; label: string; count: number }> = [
		{
			id: "postings",
			label: "Transactions",
			count: displayDocument?.postings.length ?? 0,
		},
		{
			id: "accounts",
			label: "Accounts",
			count: displayDocument?.accounts.length ?? 0,
		},
		{
			id: "history",
			label: "Balance history",
			count: displayDocument?.checkpoints.length ?? 0,
		},
	];

	return (
		<Card className="rounded-[1.8rem] border-border/80">
			<CardHeader>
				<CardTitle>Model inputs</CardTitle>
				<CardDescription>
					Transactions, accounts, and balance history that drive the projection.
					Validation: {validationSummary}.
				</CardDescription>
				<CardAction className="flex flex-wrap justify-end gap-2">
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
				</CardAction>
			</CardHeader>

			<CardContent className="space-y-5">
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
							<div className="flex flex-wrap gap-2">
								{tabs.map((tab) => (
									<button
										key={tab.id}
										type="button"
										onClick={() => setActiveTab(tab.id)}
										className={tabClassName(activeTab === tab.id)}
									>
										{tab.label} <span className="opacity-70">{tab.count}</span>
									</button>
								))}
							</div>

							{!isEditing ? (
								<button
									type="button"
									onClick={() => setShowAdvanced(!showAdvanced)}
									className="rounded-lg border border-border px-3 py-1.5 type-label transition hover:border-ring hover:text-foreground"
								>
									{showAdvanced
										? "Hide raw IDs and formulas"
										: "Show raw IDs and formulas"}
								</button>
							) : null}
						</div>

						{activeTab === "postings" ? (
							isEditing ? (
								<EditablePostingsTable
									displayDocument={displayDocument}
									document={document}
									isDirty={isDirty}
									workingDocument={workingDocument}
									projectionStartDate={projectionStartDate}
									updatePosting={updatePosting}
									deletePosting={deletePosting}
									addPosting={addPosting}
								/>
							) : (
								<ReadOnlyPostingsTable
									postings={displayDocument.postings}
									showAdvanced={showAdvanced}
									disabledPostingSet={disabledPostingSet}
									onToggle={togglePostingDisabled}
								/>
							)
						) : null}

						{activeTab === "accounts" ? (
							isEditing ? (
								<EditableAccountsTable
									displayDocument={displayDocument}
									document={document}
									isDirty={isDirty}
									workingDocument={workingDocument}
									updateAccount={updateAccount}
									deleteAccount={deleteAccount}
									addAccount={addAccount}
								/>
							) : (
								<ReadOnlyAccountsTable
									accounts={displayDocument.accounts}
									showAdvanced={showAdvanced}
									disabledAccountSet={disabledAccountSet}
									onToggle={toggleAccountDisabled}
								/>
							)
						) : null}

						{activeTab === "history" ? (
							isEditing ? (
								<EditableCheckpointsTable
									displayDocument={displayDocument}
									isDirty={isDirty}
									projectionStartDate={projectionStartDate}
									updateCheckpoint={updateCheckpoint}
									deleteCheckpoint={deleteCheckpoint}
									addCheckpoint={addCheckpoint}
								/>
							) : (
								<ReadOnlyCheckpointsTable
									checkpoints={displayDocument.checkpoints}
									showAdvanced={showAdvanced}
									accountLabelById={accountLabelById}
								/>
							)
						) : null}
					</>
				) : (
					<div className="rounded-2xl border border-dashed border-border/80 bg-surface/70 px-4 py-8 text-center type-muted dark:border-white/10 dark:bg-surface/50">
						No financial model loaded yet.
					</div>
				)}

				{document ? (
					<div className="border-t border-border/70 pt-5">
						<CurrentChangesControls document={document} />
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
