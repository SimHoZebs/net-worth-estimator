import { type ReactNode, useState } from "react";
import { useShallow } from "zustand/shallow";
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
import type {
	DataSource,
	ScenarioPack,
	ScenarioValidationIssue,
} from "@/lib/projection";
import { selectEditorActions, selectEditorState, useStore } from "@/store";
import { ScenarioValidationPanel } from "./ScenarioValidationPanel";

type InputTab = "postings" | "accounts" | "history";

interface ScenarioInspectorProps {
	projectionStartDate: string;
	pack: ScenarioPack | null;
	issues: ScenarioValidationIssue[];
	dataSource: DataSource;
	isLoading: boolean;
	loadError: string | null;
	sourceActionError: string | null;
	onReload: () => void;
	onSave: () => void;
	isSaving: boolean;
	overridesSlot?: ReactNode;
}

function tabClassName(isActive: boolean) {
	return `rounded-full px-3 py-1.5 text-xs font-medium transition ${
		isActive
			? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm dark:shadow-slate-900/30"
			: "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-slate-100"
	}`;
}

export function ScenarioInspector({
	projectionStartDate,
	pack,
	issues,
	dataSource,
	isLoading,
	loadError,
	sourceActionError,
	onReload,
	onSave,
	isSaving,
	overridesSlot,
}: ScenarioInspectorProps) {
	const disabledAccountIds = useStore((s) => s.disabledAccountIds);
	const disabledPostingIds = useStore((s) => s.disabledPostingIds);
	const toggleAccountDisabled = useStore((s) => s.toggleAccountDisabled);
	const togglePostingDisabled = useStore((s) => s.togglePostingDisabled);
	const { isEditing, isDirty, workingPack } = useStore(
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
	const displayPack = isEditing && workingPack ? workingPack : pack;
	const accountLabelById = new Map(
		displayPack?.accounts.map((account) => [account.id, account.label]) ?? [],
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
				: pack
					? "Clean"
					: "Pending";

	const tabs: Array<{ id: InputTab; label: string; count: number }> = [
		{
			id: "postings",
			label: "Transactions",
			count: displayPack?.postings.length ?? 0,
		},
		{
			id: "accounts",
			label: "Accounts",
			count: displayPack?.accounts.length ?? 0,
		},
		{
			id: "history",
			label: "Balance history",
			count: displayPack?.checkpoints.length ?? 0,
		},
	];

	return (
		<Card className="rounded-[1.8rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
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
								onClick={onSave}
								disabled={!isDirty || !dataSource.save || isSaving}
							>
								{isSaving
									? "Saving..."
									: (dataSource.save?.label ?? "Save unavailable")}
							</Button>
						</>
					) : (
						<>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={onReload}
								disabled={isLoading}
							>
								{isLoading ? "Loading..." : "Reload"}
							</Button>
							{pack && dataSource.save ? (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => startEditing(pack)}
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
						<AlertTitle>Data pack could not be loaded</AlertTitle>
						<AlertDescription>{loadError}</AlertDescription>
					</Alert>
				) : null}

				{sourceActionError ? (
					<Alert variant="destructive" className="rounded-[1.6rem]">
						<AlertTitle>Source action failed</AlertTitle>
						<AlertDescription>{sourceActionError}</AlertDescription>
					</Alert>
				) : null}

				{issues.length > 0 ? <ScenarioValidationPanel issues={issues} /> : null}

				{pack && displayPack ? (
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
									className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 transition hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-800 dark:hover:text-slate-200"
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
									displayPack={displayPack}
									pack={pack}
									isDirty={isDirty}
									workingPack={workingPack}
									projectionStartDate={projectionStartDate}
									updatePosting={updatePosting}
									deletePosting={deletePosting}
									addPosting={addPosting}
								/>
							) : (
								<ReadOnlyPostingsTable
									postings={displayPack.postings}
									showAdvanced={showAdvanced}
									disabledPostingSet={disabledPostingSet}
									onToggle={togglePostingDisabled}
								/>
							)
						) : null}

						{activeTab === "accounts" ? (
							isEditing ? (
								<EditableAccountsTable
									displayPack={displayPack}
									pack={pack}
									isDirty={isDirty}
									workingPack={workingPack}
									updateAccount={updateAccount}
									deleteAccount={deleteAccount}
									addAccount={addAccount}
								/>
							) : (
								<ReadOnlyAccountsTable
									accounts={displayPack.accounts}
									showAdvanced={showAdvanced}
									disabledAccountSet={disabledAccountSet}
									onToggle={toggleAccountDisabled}
								/>
							)
						) : null}

						{activeTab === "history" ? (
							isEditing ? (
								<EditableCheckpointsTable
									displayPack={displayPack}
									isDirty={isDirty}
									projectionStartDate={projectionStartDate}
									updateCheckpoint={updateCheckpoint}
									deleteCheckpoint={deleteCheckpoint}
									addCheckpoint={addCheckpoint}
								/>
							) : (
								<ReadOnlyCheckpointsTable
									checkpoints={displayPack.checkpoints}
									showAdvanced={showAdvanced}
									accountLabelById={accountLabelById}
								/>
							)
						) : null}
					</>
				) : (
					<div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
						No scenario data loaded yet.
					</div>
				)}

				{overridesSlot ? (
					<div className="border-t border-slate-100 dark:border-slate-700 pt-5">
						{overridesSlot}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
