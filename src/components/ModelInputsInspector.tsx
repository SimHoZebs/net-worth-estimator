import { useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { EmptyState, SectionCard } from "@/components/present/present";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { currency, formatDate } from "@/lib/format";
import {
	associatedAccountIds,
	isPastScheduledPosting,
	partitionPostings,
} from "@/lib/posting-categories";
import type {
	Account,
	FinancialModelDocument,
	Posting,
} from "@/lib/projection";
import { getExpression } from "@/lib/projection";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useProjectionArtifacts } from "@/runtime/projectionRuntime";
import {
	selectCurrentChangeCount,
	selectEditorActions,
	selectEditorState,
	useStore,
} from "@/store";
import { AccountForm, accountFormInitial } from "./banking/AccountForm";
import { CheckpointForm } from "./banking/CheckpointForm";
import { MoneyDetail } from "./banking/MoneyDetail";
import { MoneyFeed } from "./banking/MoneyFeed";
import {
	buildPosting,
	MoneyForm,
	type MoneyFormValue,
	moneyFormDefault,
	moneyFormFromPosting,
} from "./banking/MoneyForm";
import { MoneyAmountText, MoneyAvatar } from "./banking/MoneyRow";
import { type MoneyDirection, moneyDirection, slugId } from "./banking/money";
import { DateText } from "./dashboard/tables/primitives/formatting";
import { ConfirmButton } from "./dashboard/tables/primitives/shells";
import { countIssuesByTab, ModelValidationPanel } from "./ModelValidationPanel";

type InputSection = "accounts" | "scheduled" | "activity" | "reconcile";

type MoneyFormState =
	| { mode: "create"; preset: Partial<MoneyFormValue> }
	| { mode: "edit"; posting: Posting };

function tabClassName(isActive: boolean) {
	return `rounded-full px-3 py-1.5 type-caption font-medium transition ${
		isActive
			? "bg-primary text-primary-foreground shadow-sm"
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
		dataUpdatedAt,
		reload,
		save,
	} = useModelRuntime();
	const { result, projectionResultIsStale } = useProjectionArtifacts();
	const { isDirty, workingDocument, editingBaseline } = useStore(
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
	} = useStore(useShallow(selectEditorActions));
	const currentChangeCount = useStore(selectCurrentChangeCount);

	const [activeSection, setActiveSection] = useState<InputSection>("accounts");
	const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
		null,
	);
	const [accountQuery, setAccountQuery] = useState("");
	const [detailPostingId, setDetailPostingId] = useState<string | null>(null);
	const [moneyForm, setMoneyForm] = useState<MoneyFormState | null>(null);
	const [accountForm, setAccountForm] = useState<
		{ mode: "create" } | { mode: "edit"; account: Account } | null
	>(null);
	const [checkpointOpen, setCheckpointOpen] = useState(false);
	const [showPending, setShowPending] = useState(false);

	// The draft IS the view. Canonical data is untouched until save.
	const readDocument = useMemo(() => {
		if (!document) return null;
		return {
			...document,
			accounts: document.accounts.filter((account) => account.enabled),
			postings: document.postings.filter((posting) => posting.enabled),
		};
	}, [document]);
	const displayDocument: FinancialModelDocument | null =
		workingDocument ?? readDocument;

	const postingGroups = useMemo(
		() => partitionPostings(displayDocument?.postings ?? []),
		[displayDocument?.postings],
	);
	const accountById = useMemo(
		() => new Map((displayDocument?.accounts ?? []).map((a) => [a.id, a])),
		[displayDocument],
	);
	const accountIds = useMemo(
		() => new Set(displayDocument?.accounts.map((a) => a.id) ?? []),
		[displayDocument],
	);
	const summariesById = useMemo(
		() =>
			new Map(
				(result?.accountSummaries ?? []).map((summary) => [
					summary.accountId,
					summary,
				]),
			),
		[result],
	);
	const balancesAvailable =
		result?.accountSummaries != null && !projectionResultIsStale;

	const balanceOf = (accountId: string): number | null => {
		if (!balancesAvailable) return null;
		const summary = summariesById.get(accountId);
		return summary?.enabled ? summary.startingBalance : null;
	};

	const scheduledPostings = postingGroups.scheduledTransactions;
	const historyPostings = postingGroups.transactionHistory;
	const visibleCheckpoints = displayDocument?.checkpoints ?? [];

	const ensureEditing = () => {
		if (!workingDocument && document) startEditing(document);
	};

	const allPostings = displayDocument?.postings ?? [];
	const detailPosting =
		allPostings.find((p) => p.id === detailPostingId) ?? null;
	const draft = workingDocument;
	const baseline = editingBaseline ?? document;
	const baselineAccountIds = useMemo(
		() => new Set(baseline?.accounts.map((a) => a.id) ?? []),
		[baseline],
	);
	const baselinePostingIds = useMemo(
		() => new Set(baseline?.postings.map((p) => p.id) ?? []),
		[baseline],
	);
	const addedAccounts =
		draft?.accounts.filter((a) => !baselineAccountIds.has(a.id)) ?? [];
	const addedPostings =
		draft?.postings.filter((p) => !baselinePostingIds.has(p.id)) ?? [];
	const excludedAccounts = draft?.accounts.filter((a) => !a.enabled) ?? [];
	const excludedPostings = draft?.postings.filter((p) => !p.enabled) ?? [];
	const baselineAccountById = useMemo(
		() => new Map(baseline?.accounts.map((a) => [a.id, a]) ?? []),
		[baseline],
	);
	const baselinePostingById = useMemo(
		() => new Map(baseline?.postings.map((p) => [p.id, p]) ?? []),
		[baseline],
	);
	const draftAccountIds = useMemo(
		() => new Set(draft?.accounts.map((a) => a.id) ?? []),
		[draft],
	);
	const draftPostingIds = useMemo(
		() => new Set(draft?.postings.map((p) => p.id) ?? []),
		[draft],
	);
	// Modified-but-enabled rows. Disabled rows render under Excluded instead
	// so nothing is listed twice; added rows render under New.
	const modifiedAccounts = useMemo(
		() =>
			draft?.accounts.filter((a) => {
				if (!a.enabled || !baselineAccountIds.has(a.id)) return false;
				const original = baselineAccountById.get(a.id);
				return (
					original !== undefined &&
					JSON.stringify(a) !== JSON.stringify(original)
				);
			}) ?? [],
		[draft?.accounts, baselineAccountIds, baselineAccountById],
	);
	const modifiedPostings = useMemo(
		() =>
			draft?.postings.filter((p) => {
				if (!p.enabled || !baselinePostingIds.has(p.id)) return false;
				const original = baselinePostingById.get(p.id);
				return (
					original !== undefined &&
					JSON.stringify(p) !== JSON.stringify(original)
				);
			}) ?? [],
		[draft?.postings, baselinePostingIds, baselinePostingById],
	);
	const removedAccounts = useMemo(
		() => baseline?.accounts.filter((a) => !draftAccountIds.has(a.id)) ?? [],
		[baseline?.accounts, draftAccountIds],
	);
	const removedPostings = useMemo(
		() => baseline?.postings.filter((p) => !draftPostingIds.has(p.id)) ?? [],
		[baseline?.postings, draftPostingIds],
	);
	// Checkpoints carry no stable ID, so diffs compare positionally (same as
	// countDocumentDiff) and describe each changed slot.
	const checkpointChanges = useMemo(() => {
		const before = baseline?.checkpoints ?? [];
		const after = draft?.checkpoints ?? [];
		const changes: { key: string; text: string }[] = [];
		const rowCount = Math.max(before.length, after.length);
		for (let index = 0; index < rowCount; index++) {
			const original = before[index];
			const current = after[index];
			if (original === undefined && current !== undefined) {
				changes.push({
					key: `checkpoint-added-${index}`,
					text: `Added checkpoint: ${currency.format(current.Balance)} on ${formatDate(current.Date)}`,
				});
			} else if (original !== undefined && current === undefined) {
				changes.push({
					key: `checkpoint-removed-${index}`,
					text: `Removed checkpoint: ${currency.format(original.Balance)} on ${formatDate(original.Date)}`,
				});
			} else if (
				original !== undefined &&
				current !== undefined &&
				JSON.stringify(current) !== JSON.stringify(original)
			) {
				changes.push({
					key: `checkpoint-modified-${index}`,
					text: `Changed checkpoint: ${currency.format(original.Balance)} on ${formatDate(original.Date)} → ${currency.format(current.Balance)} on ${formatDate(current.Date)}`,
				});
			}
		}
		return changes;
	}, [baseline?.checkpoints, draft?.checkpoints]);

	const tabs: { id: InputSection; label: string }[] = [
		{ id: "accounts", label: "Accounts" },
		{ id: "scheduled", label: "Scheduled" },
		{ id: "activity", label: "Activity" },
		{ id: "reconcile", label: "Reconcile" },
	];
	const issueCounts = useMemo(
		() => countIssuesByTab(issues, document?.postings),
		[issues, document?.postings],
	);

	const lastLoaded =
		dataUpdatedAt === 0
			? "Not loaded"
			: new Date(dataUpdatedAt).toLocaleDateString();

	const openCreate = (direction: MoneyDirection, fromAccountId?: string) => {
		if (!displayDocument) return;
		ensureEditing();
		setMoneyForm({
			mode: "create",
			preset: moneyFormDefault(
				displayDocument.accounts,
				projectionStartDate,
				direction,
				fromAccountId ?? selectedAccountId ?? undefined,
			),
		});
	};

	const submitMoneyForm =
		(posting: Posting | null) => (formValue: MoneyFormValue) => {
			const amountLocked = posting !== null && getExpression(posting) === null;
			const built = buildPosting(posting, formValue);
			if (built.error) return built.error;
			ensureEditing();
			if (posting) {
				const { ...changes } = built.posting;
				updatePosting(posting.id, {
					...changes,
					// Calculated pipelines (e.g. payroll income resolver) have no
					// expression to edit; preserve the original amount untouched.
					...(amountLocked ? { amount: posting.amount } : null),
				});
			} else {
				const reserved = new Set([
					...(displayDocument?.accounts.map((a) => a.id) ?? []),
					...(displayDocument?.postings.map((p) => p.id) ?? []),
				]);
				let id = slugId(formValue.label, "money");
				while (reserved.has(id)) id = `${id}-2`;
				addPosting({ ...built.posting, id, enabled: true });
			}
			setMoneyForm(null);
			setDetailPostingId(null);
		};

	return (
		<SectionCard
			action={
				<div className="flex flex-wrap justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="min-h-11"
						onClick={reload}
						disabled={isLoading}
					>
						{isLoading ? "Loading..." : "Reload"}
					</Button>
					{displayDocument ? (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="min-h-11"
							onClick={() => setAccountForm({ mode: "create" })}
						>
							+ Account
						</Button>
					) : null}
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

			<p className="truncate type-caption text-muted-foreground">
				{source.label} · {lastLoaded}
			</p>

			{document && displayDocument ? (
				<>
					<QuickActions
						onPay={() => openCreate("out")}
						onTransfer={() => openCreate("transfer")}
						onReceive={() => openCreate("in")}
						onVerify={() => {
							ensureEditing();
							setCheckpointOpen(true);
						}}
					/>
					<div className="flex flex-wrap items-center gap-3">
						<fieldset className="flex flex-wrap gap-2">
							<legend className="sr-only">Sections</legend>
							{tabs.map((tab) => {
								const tabIssues = issueCounts[tab.id] ?? 0;
								const isActive = activeSection === tab.id;
								return (
									<button
										key={tab.id}
										type="button"
										aria-pressed={isActive}
										aria-label={`${tab.label}${tabIssues > 0 ? `, ${tabIssues} validation ${tabIssues === 1 ? "issue" : "issues"}` : ""}`}
										title={
											tabIssues > 0
												? `${tabIssues} validation ${tabIssues === 1 ? "issue" : "issues"} — see Reconcile`
												: undefined
										}
										onClick={() => {
											setActiveSection(tab.id);
											setDetailPostingId(null);
											setMoneyForm(null);
										}}
										className={`${tabClassName(isActive)} relative min-h-11`}
									>
										{tab.label}
										{tab.id === "reconcile" && tabIssues > 0 ? (
											<span
												aria-hidden="true"
												className="ml-1 rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold text-white"
											>
												{tabIssues}
											</span>
										) : null}
										{tab.id !== "reconcile" && tabIssues > 0 ? (
											<span
												aria-hidden="true"
												className="absolute top-1 right-1 size-2 rounded-full bg-destructive"
											/>
										) : null}
									</button>
								);
							})}
						</fieldset>
					</div>

					<div className="space-y-4">
						{activeSection === "accounts" ? (
							<AccountsView
								accounts={displayDocument.accounts}
								accountQuery={accountQuery}
								onQuery={setAccountQuery}
								selectedAccountId={selectedAccountId}
								onSelect={setSelectedAccountId}
								balanceOf={balanceOf}
								balancesAvailable={balancesAvailable}
								currentNetWorth={result?.summary.currentNetWorth ?? null}
								projectionStartDate={
									result?.milestones.projectionStartDate ?? projectionStartDate
								}
								rulesFor={(accountId) =>
									displayDocument.postings.filter((posting) =>
										associatedAccountIds(posting, accountIds).includes(
											accountId,
										),
									)
								}
								activityFor={(accountId) =>
									postingGroups.transactionHistory
										.filter((posting) =>
											associatedAccountIds(posting, accountIds).includes(
												accountId,
											),
										)
										.sort((a, b) => b.startDate.localeCompare(a.startDate))
										.slice(0, 10)
								}
								accountById={accountById}
								latestCheckpointFor={(accountId) =>
									displayDocument.checkpoints
										.filter((c) => c.AccountId === accountId)
										.sort((a, b) => b.Date.localeCompare(a.Date))[0] ?? null
								}
								onOpenPosting={(posting) => setDetailPostingId(posting.id)}
								onNewMoney={(direction, accountId) =>
									openCreate(direction, accountId)
								}
								onEditAccount={(account) =>
									setAccountForm({ mode: "edit", account })
								}
								onDeleteAccount={(account) => {
									ensureEditing();
									deleteAccount(account.id);
									setSelectedAccountId(null);
								}}
								onVerify={(accountId) => {
									ensureEditing();
									setSelectedAccountId(accountId);
									setCheckpointOpen(true);
								}}
								onExcludeAccount={(id) => {
									ensureEditing();
									updateAccount(id, { enabled: false });
									setSelectedAccountId(null);
								}}
							/>
						) : null}

						{activeSection === "scheduled" ? (
							<ScheduledView
								postings={scheduledPostings}
								accounts={displayDocument.accounts}
								projectionStartDate={projectionStartDate}
								onOpen={(posting) => setDetailPostingId(posting.id)}
								onAdd={() => openCreate("transfer")}
							/>
						) : null}

						{activeSection === "activity" ? (
							<MoneyFeed
								postings={historyPostings}
								accounts={displayDocument.accounts}
								emptyText="No activity yet. Record a one-time movement to start the history."
								searchLabel="Search activity"
								emptyAction={
									<Button
										type="button"
										variant="secondary"
										size="sm"
										className="min-h-11"
										onClick={() => openCreate("out")}
									>
										New movement
									</Button>
								}
								onOpen={(posting) => setDetailPostingId(posting.id)}
								groupByDate
								dateDescending
							/>
						) : null}

						{activeSection === "reconcile" ? (
							<div className="space-y-4">
								{issues.length > 0 ? (
									<ModelValidationPanel issues={issues} />
								) : null}
								<StatementsView
									accounts={displayDocument.accounts}
									checkpoints={visibleCheckpoints}
									balanceOf={balanceOf}
									onVerify={(accountId) => {
										ensureEditing();
										if (accountId) setSelectedAccountId(accountId);
										setCheckpointOpen(true);
									}}
									onDelete={(accountId, date) => {
										ensureEditing();
										const index = displayDocument.checkpoints.findIndex(
											(c) => c.AccountId === accountId && c.Date === date,
										);
										if (index >= 0) deleteCheckpoint(index);
									}}
								/>
							</div>
						) : null}
					</div>
				</>
			) : (
				<EmptyState className="bg-surface/70 px-4 py-8 text-center dark:border-white/10 dark:bg-surface/50">
					<div className="space-y-3">
						<p>No financial model loaded yet.</p>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="min-h-11"
							onClick={reload}
							disabled={isLoading}
						>
							{isLoading ? "Loading..." : "Reload"}
						</Button>
					</div>
				</EmptyState>
			)}

			{document ? (
				<PendingDock
					count={currentChangeCount}
					isDirty={isDirty}
					isSaving={isSaving}
					saveLabel={source.saveLabel}
					open={showPending || currentChangeCount > 0}
					onToggle={() => setShowPending(!showPending)}
					onSave={save}
					onDiscard={() => {
						if (
							window.confirm(
								"Discard all unsaved changes? This cannot be undone.",
							)
						) {
							cancelEditing();
						}
					}}
					addedAccounts={addedAccounts}
					addedPostings={addedPostings}
					modifiedAccounts={modifiedAccounts}
					modifiedPostings={modifiedPostings}
					removedAccounts={removedAccounts}
					removedPostings={removedPostings}
					checkpointChanges={checkpointChanges}
					excludedAccounts={excludedAccounts}
					excludedPostings={excludedPostings}
					onRestoreAccount={(id) => updateAccount(id, { enabled: true })}
					onRestorePosting={(id) => updatePosting(id, { enabled: true })}
					onRemoveAccount={(id) => deleteAccount(id)}
					onRemovePosting={(id) => deletePosting(id)}
				/>
			) : null}

			{detailPosting && displayDocument ? (
				<MoneyDetail
					posting={detailPosting}
					accounts={displayDocument.accounts}
					excluded={false}
					onClose={() => setDetailPostingId(null)}
					onEdit={() => setMoneyForm({ mode: "edit", posting: detailPosting })}
					onExclude={() => {
						ensureEditing();
						updatePosting(detailPosting.id, { enabled: false });
						setDetailPostingId(null);
					}}
					onRestore={() => {
						updatePosting(detailPosting.id, { enabled: true });
						setDetailPostingId(null);
					}}
					onDelete={() => {
						ensureEditing();
						deletePosting(detailPosting.id);
						setDetailPostingId(null);
					}}
				/>
			) : null}

			{moneyForm && displayDocument ? (
				<MoneyForm
					title={
						moneyForm.mode === "create"
							? "New money movement"
							: `Edit ${moneyForm.posting.label}`
					}
					accounts={displayDocument.accounts}
					initial={
						moneyForm.mode === "create"
							? {
									...moneyFormDefault(
										displayDocument.accounts,
										projectionStartDate,
									),
									...moneyForm.preset,
								}
							: moneyFormFromPosting(moneyForm.posting)
					}
					submitLabel={moneyForm.mode === "create" ? "Add" : "Save"}
					amountLockedExplanation={
						moneyForm.mode === "edit" &&
						getExpression(moneyForm.posting) === null
							? "Calculated by a payroll pipeline — route and schedule remain editable, the calculation stays as is."
							: null
					}
					onSubmit={submitMoneyForm(
						moneyForm.mode === "edit" ? moneyForm.posting : null,
					)}
					onClose={() => setMoneyForm(null)}
				/>
			) : null}

			{accountForm && displayDocument ? (
				<AccountForm
					title={
						accountForm.mode === "create"
							? "New account"
							: `Edit ${accountForm.account.label}`
					}
					initial={accountFormInitial(
						accountForm.mode === "edit" ? accountForm.account : undefined,
					)}
					submitLabel={accountForm.mode === "create" ? "Add account" : "Save"}
					onClose={() => setAccountForm(null)}
					onSubmit={(next) => {
						if (accountForm.mode === "create") {
							if (!displayDocument) return "No model loaded.";
							ensureEditing();
							const reserved = new Set([
								...displayDocument.accounts.map((a) => a.id),
								...displayDocument.postings.map((p) => p.id),
							]);
							let id = slugId(next.label, "acct");
							while (reserved.has(id)) id = `${id}-2`;
							addAccount({
								id,
								label: next.label,
								minBalance: next.minBalance,
								maxBalance: next.maxBalance,
								color: next.color,
								enabled: true,
							});
							setAccountForm(null);
							return;
						}
						updateAccount(accountForm.account.id, {
							label: next.label,
							color: next.color,
							minBalance: next.minBalance,
							maxBalance: next.maxBalance,
						});
						setAccountForm(null);
					}}
				/>
			) : null}

			{checkpointOpen && displayDocument ? (
				<CheckpointForm
					accounts={displayDocument.accounts}
					initialAccountId={
						selectedAccountId ?? displayDocument.accounts[0]?.id ?? ""
					}
					initialDate={projectionStartDate}
					onClose={() => setCheckpointOpen(false)}
					onSubmit={({ accountId, date, balance }) => {
						ensureEditing();
						addCheckpoint({
							Date: date,
							AccountId: accountId,
							Balance: balance,
						});
						setCheckpointOpen(false);
					}}
				/>
			) : null}
		</SectionCard>
	);
}

function QuickActions({
	onPay,
	onTransfer,
	onReceive,
	onVerify,
}: {
	onPay: () => void;
	onTransfer: () => void;
	onReceive: () => void;
	onVerify: () => void;
}) {
	const actions = [
		{ label: "Pay", onClick: onPay },
		{ label: "Transfer", onClick: onTransfer },
		{ label: "Receive", onClick: onReceive },
		{ label: "Verify", onClick: onVerify },
	];
	return (
		<div className="grid grid-cols-4 gap-2">
			{actions.map((action) => (
				<button
					key={action.label}
					type="button"
					onClick={action.onClick}
					className="min-h-11 rounded-2xl border border-border/80 bg-card/85 px-2 py-3 type-value text-sm transition hover:border-ring hover:shadow-sm"
				>
					{action.label}
				</button>
			))}
		</div>
	);
}

function AccountsView({
	accounts,
	accountQuery,
	onQuery,
	selectedAccountId,
	onSelect,
	balanceOf,
	balancesAvailable,
	currentNetWorth,
	projectionStartDate,
	rulesFor,
	activityFor,
	accountById,
	latestCheckpointFor,
	onOpenPosting,
	onNewMoney,
	onEditAccount,
	onDeleteAccount,
	onVerify,
	onExcludeAccount,
}: {
	accounts: Account[];
	accountQuery: string;
	onQuery: (query: string) => void;
	selectedAccountId: string | null;
	onSelect: (id: string | null) => void;
	balanceOf: (accountId: string) => number | null;
	balancesAvailable: boolean;
	currentNetWorth: number | null;
	projectionStartDate: string;
	rulesFor: (accountId: string) => Posting[];
	activityFor: (accountId: string) => Posting[];
	accountById: ReadonlyMap<string, Account>;
	latestCheckpointFor: (
		accountId: string,
	) => { Date: string; Balance: number } | null;
	onOpenPosting: (posting: Posting) => void;
	onNewMoney: (direction: MoneyDirection, accountId: string) => void;
	onEditAccount: (account: Account) => void;
	onDeleteAccount: (account: Account) => void;
	onVerify: (accountId: string) => void;
	onExcludeAccount: (id: string) => void;
}) {
	const normalized = accountQuery.trim().toLowerCase();
	const matching = accounts.filter(
		(account) =>
			!normalized ||
			account.label.toLowerCase().includes(normalized) ||
			account.id.toLowerCase().includes(normalized),
	);
	const selected = selectedAccountId
		? accountById.get(selectedAccountId)
		: null;

	if (selected) {
		return (
			<AccountDetail
				account={selected}
				balance={balanceOf(selected.id)}
				rules={rulesFor(selected.id)}
				activity={activityFor(selected.id)}
				accountById={accountById}
				latestCheckpoint={latestCheckpointFor(selected.id)}
				onBack={() => onSelect(null)}
				onOpenPosting={onOpenPosting}
				onNewMoney={(direction) => onNewMoney(direction, selected.id)}
				onEdit={() => onEditAccount(selected)}
				onDelete={() => onDeleteAccount(selected)}
				onVerify={() => onVerify(selected.id)}
				onExclude={() => onExcludeAccount(selected.id)}
			/>
		);
	}

	const rows = matching.map((account) => ({
		account,
		balance: balanceOf(account.id),
	}));
	const ordered = [...rows].sort(
		(a, b) => (b.balance ?? -Infinity) - (a.balance ?? -Infinity),
	);
	const assetsTotal = rows.reduce(
		(sum, row) =>
			sum + (row.balance !== null && row.balance >= 0 ? row.balance : 0),
		0,
	);
	const debtsTotal = rows.reduce(
		(sum, row) =>
			sum + (row.balance !== null && row.balance < 0 ? row.balance : 0),
		0,
	);

	return (
		<div className="space-y-4">
			<section className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-gradient-to-br from-card via-card to-surface/70">
				<div className="border-b border-border/70 p-5">
					<div className="mt-1 type-metric text-foreground">
						{balancesAvailable && currentNetWorth !== null
							? currency.format(currentNetWorth)
							: "—"}
					</div>
					<p className="mt-1 type-caption text-muted-foreground">
						As of <DateText value={projectionStartDate} />
					</p>
				</div>
				<div className="grid grid-cols-2 divide-x divide-border/70">
					<div className="px-5 py-4">
						<div className="type-label">In</div>
						<div className="mt-1 type-value text-[color:var(--chart-success)]">
							{balancesAvailable ? currency.format(assetsTotal) : "—"}
						</div>
					</div>
					<div className="px-5 py-4">
						<div className="type-label">Owed</div>
						<div className="mt-1 type-value text-destructive">
							{balancesAvailable ? currency.format(Math.abs(debtsTotal)) : "—"}
						</div>
					</div>
				</div>
			</section>

			<div className="flex flex-wrap items-center gap-2">
				<input
					type="search"
					value={accountQuery}
					onChange={(event) => onQuery(event.target.value)}
					placeholder="Search"
					aria-label="Search accounts"
					className="min-h-11 w-full rounded-full border border-border bg-card px-4 py-2.5 type-body placeholder:text-muted-foreground sm:max-w-xs"
				/>
				<span aria-live="polite" className="sr-only">
					{ordered.length} {ordered.length === 1 ? "account" : "accounts"}
				</span>
			</div>
			{ordered.length === 0 ? (
				<p role="status" className="type-muted">
					None.
				</p>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{ordered.map(({ account, balance }) => (
						<button
							key={account.id}
							type="button"
							onClick={() => onSelect(account.id)}
							className="rounded-2xl border border-border/80 bg-card/70 p-4 text-left transition hover:border-ring"
						>
							<span className="flex items-center gap-2">
								<span
									aria-hidden="true"
									className="size-3 rounded-full"
									style={{ backgroundColor: account.color ?? "#64748b" }}
								/>
								<span className="min-w-0 flex-1 truncate type-value">
									{account.label}
								</span>
							</span>
							<span className="mt-2 block type-metric text-xl">
								{balance === null ? "—" : currency.format(balance)}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function AccountDetail({
	account,
	balance,
	rules,
	activity,
	accountById,
	latestCheckpoint,
	onBack,
	onOpenPosting,
	onNewMoney,
	onEdit,
	onDelete,
	onVerify,
	onExclude,
}: {
	account: Account;
	balance: number | null;
	rules: Posting[];
	activity: Posting[];
	accountById: ReadonlyMap<string, Account>;
	latestCheckpoint: { Date: string; Balance: number } | null;
	onBack: () => void;
	onOpenPosting: (posting: Posting) => void;
	onNewMoney: (direction: MoneyDirection) => void;
	onEdit: () => void;
	onDelete: () => void;
	onVerify: () => void;
	onExclude: () => void;
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	return (
		<div className="space-y-4">
			<button
				type="button"
				onClick={onBack}
				className="type-label text-muted-foreground hover:text-foreground"
			>
				‹ Accounts
			</button>
			<div className="flex items-center gap-3">
				<MoneyAvatar
					label={account.label}
					color={account.color}
					direction="transfer"
				/>
				<div className="min-w-0 flex-1">
					<h3 className="truncate type-title text-lg">{account.label}</h3>
					<p className="type-caption">
						{balance === null ? "—" : currency.format(balance)}
						{latestCheckpoint
							? ` · ${formatDate(latestCheckpoint.Date)} · ${currency.format(latestCheckpoint.Balance)}`
							: " · Unverified"}
					</p>
				</div>
			</div>

			<div className="grid grid-cols-4 gap-2">
				{(
					[
						["Pay", () => onNewMoney("out")],
						["Transfer", () => onNewMoney("transfer")],
						["Receive", () => onNewMoney("in")],
						["Verify", onVerify],
					] as const
				).map(([label, onClick]) => (
					<button
						key={label}
						type="button"
						onClick={onClick}
						className="min-h-11 rounded-2xl border border-border/80 bg-card/85 px-2 py-2.5 type-value text-sm transition hover:border-ring"
					>
						{label}
					</button>
				))}
			</div>

			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="min-h-11"
					onClick={onEdit}
				>
					Edit
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="min-h-11"
					onClick={onExclude}
				>
					Exclude
				</Button>
				{confirmingDelete ? (
					<Button
						type="button"
						variant="destructive"
						size="sm"
						className="min-h-11"
						onClick={onDelete}
					>
						Confirm delete
					</Button>
				) : (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="min-h-11"
						onClick={() => setConfirmingDelete(true)}
					>
						Delete
					</Button>
				)}
			</div>

			{rules.length > 0 ? (
				<div>
					<h4 className="mb-1.5 px-1 type-label text-muted-foreground">
						Scheduled
					</h4>
					<div className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card/70">
						{rules.map((posting) => (
							<MoneyRowInline
								key={posting.id}
								posting={posting}
								accountById={accountById}
								onOpen={onOpenPosting}
							/>
						))}
					</div>
				</div>
			) : null}

			{activity.length > 0 ? (
				<div>
					<h4 className="mb-1.5 px-1 type-label text-muted-foreground">
						Recent
					</h4>
					<div className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card/70">
						{activity.map((posting) => (
							<MoneyRowInline
								key={posting.id}
								posting={posting}
								accountById={accountById}
								onOpen={onOpenPosting}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function MoneyRowInline({
	posting,
	accountById,
	onOpen,
}: {
	posting: Posting;
	accountById: ReadonlyMap<string, Account>;
	onOpen: (posting: Posting) => void;
}) {
	const direction = moneyDirection(posting);
	const source = posting.sourceAccountId
		? accountById.get(posting.sourceAccountId)
		: null;
	const firstDestination =
		posting.destinations?.[0] !== undefined
			? accountById.get(posting.destinations[0])
			: null;
	return (
		<button
			type="button"
			onClick={() => onOpen(posting)}
			className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-accent/50"
		>
			<MoneyAvatar
				label={posting.label}
				color={(source ?? firstDestination)?.color}
				direction={direction}
			/>
			<span className="min-w-0 flex-1 truncate type-value text-sm">
				{posting.label}
			</span>
			<span className="shrink-0 type-value text-sm">
				<MoneyAmountText posting={posting} />
			</span>
		</button>
	);
}

function ScheduledView({
	postings,
	accounts,
	projectionStartDate,
	onOpen,
	onAdd,
}: {
	postings: Posting[];
	accounts: Account[];
	projectionStartDate: string;
	onOpen: (posting: Posting) => void;
	onAdd: () => void;
}) {
	const current = postings.filter(
		(p) => !isPastScheduledPosting(p, projectionStartDate),
	);
	const past = postings.filter((p) =>
		isPastScheduledPosting(p, projectionStartDate),
	);
	return (
		<div className="space-y-4">
			<MoneyFeed
				postings={current}
				accounts={accounts}
				emptyText="None."
				searchLabel="Search scheduled"
				emptyAction={
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="min-h-11"
						onClick={onAdd}
					>
						New
					</Button>
				}
				onOpen={onOpen}
				dateDescending={false}
				showDate
			/>
			{past.length > 0 ? (
				<details className="rounded-2xl border border-border/70">
					<summary className="cursor-pointer min-h-11 content-center px-4 py-3 type-body font-medium text-muted-foreground">
						Ended · {past.length}
					</summary>
					<div className="border-t border-border/70 p-3">
						<MoneyFeed
							postings={past}
							accounts={accounts}
							emptyText="None."
							onOpen={onOpen}
							dateDescending={false}
							showDate
						/>
					</div>
				</details>
			) : null}
		</div>
	);
}

function StatementsView({
	accounts,
	checkpoints,
	balanceOf,
	onVerify,
	onDelete,
}: {
	accounts: Account[];
	checkpoints: { Date: string; AccountId: string; Balance: number }[];
	balanceOf: (accountId: string) => number | null;
	onVerify: (accountId: string | null) => void;
	onDelete: (accountId: string, date: string) => void;
}) {
	const labelById = new Map(accounts.map((a) => [a.id, a.label]));
	const byAccount = new Map<
		string,
		{ Date: string; AccountId: string; Balance: number }[]
	>();
	for (const checkpoint of checkpoints) {
		const group = byAccount.get(checkpoint.AccountId) ?? [];
		group.push(checkpoint);
		byAccount.set(checkpoint.AccountId, group);
	}
	const ordered = accounts
		.slice()
		.sort((a, b) => a.label.localeCompare(b.label));

	return (
		<div className="space-y-3">
			{ordered.length === 0 ? (
				<div className="space-y-3 rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center">
					<p className="type-muted">
						No accounts yet. Add one to start verifying balances.
					</p>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="min-h-11"
						onClick={() => onVerify(null)}
					>
						Verify a balance
					</Button>
				</div>
			) : (
				ordered.map((account) => {
					const rows = (byAccount.get(account.id) ?? [])
						.slice()
						.sort((a, b) => b.Date.localeCompare(a.Date));
					const latest = rows[0] ?? null;
					const modeled = balanceOf(account.id);
					return (
						<section
							key={account.id}
							aria-label={`${account.label} statements`}
							className="rounded-2xl border border-border/80 bg-card/70 p-4"
						>
							<div className="flex items-center gap-2">
								<span
									aria-hidden="true"
									className="size-3 rounded-full"
									style={{ backgroundColor: account.color ?? "#64748b" }}
								/>
								<h3 className="min-w-0 flex-1 truncate type-value">
									{account.label}
								</h3>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="min-h-11"
									onClick={() => onVerify(account.id)}
								>
									Verify
								</Button>
							</div>
							<p className="mt-1 type-caption">
								{latest
									? `${formatDate(latest.Date)} · ${currency.format(latest.Balance)}`
									: "Unverified"}
								{modeled !== null ? ` · Model ${currency.format(modeled)}` : ""}
							</p>
							{rows.length > 0 ? (
								<ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl bg-surface/55">
									{rows.map((row) => (
										<li
											key={`${row.AccountId}:${row.Date}`}
											className="flex items-center justify-between gap-3 px-3 py-2"
										>
											<span className="type-body text-sm tabular-nums">
												{formatDate(row.Date)} · {currency.format(row.Balance)}
											</span>
											<ConfirmButton
												label={`Remove checkpoint for ${labelById.get(row.AccountId) ?? row.AccountId} on ${row.Date}`}
												onConfirm={() => onDelete(row.AccountId, row.Date)}
												idleLabel="Remove"
												confirmLabel="Confirm remove"
												variant="ghost"
											/>
										</li>
									))}
								</ul>
							) : null}
						</section>
					);
				})
			)}
		</div>
	);
}

function PendingDock({
	count,
	isDirty,
	isSaving,
	saveLabel,
	open,
	onToggle,
	onSave,
	onDiscard,
	addedAccounts,
	addedPostings,
	modifiedAccounts,
	modifiedPostings,
	removedAccounts,
	removedPostings,
	checkpointChanges,
	excludedAccounts,
	excludedPostings,
	onRestoreAccount,
	onRestorePosting,
	onRemoveAccount,
	onRemovePosting,
}: {
	count: number;
	isDirty: boolean;
	isSaving: boolean;
	saveLabel: string | null;
	open: boolean;
	onToggle: () => void;
	onSave: () => void;
	onDiscard: () => void;
	addedAccounts: Account[];
	addedPostings: Posting[];
	modifiedAccounts: Account[];
	modifiedPostings: Posting[];
	removedAccounts: Account[];
	removedPostings: Posting[];
	checkpointChanges: { key: string; text: string }[];
	excludedAccounts: Account[];
	excludedPostings: Posting[];
	onRestoreAccount: (id: string) => void;
	onRestorePosting: (id: string) => void;
	onRemoveAccount: (id: string) => void;
	onRemovePosting: (id: string) => void;
}) {
	if (count === 0 && !isDirty) return null;
	const saveReason = isSaving
		? "Saving…"
		: !isDirty
			? "No unsaved changes."
			: !saveLabel
				? "Saving unavailable — read-only server or sign-in required. See Settings."
				: null;
	return (
		<div className="space-y-3">
			<div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
				<span className="type-caption">
					{count > 0 ? `${count} unsaved` : "Unsaved changes"}
				</span>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="min-h-11"
						onClick={onToggle}
					>
						{open ? "Hide" : "Review"}
					</Button>
					<Button
						type="button"
						size="sm"
						className="min-h-11"
						onClick={onSave}
						disabled={!isDirty || !saveLabel || isSaving}
						title={saveReason ?? saveLabel ?? undefined}
					>
						{isSaving ? "Saving..." : (saveLabel ?? "Save unavailable")}
					</Button>
				</div>
			</div>
			{saveReason ? (
				<p aria-live="polite" className="type-caption">
					{saveReason}
				</p>
			) : null}
			{open ? (
				<div className="space-y-4 rounded-2xl bg-surface/55 p-4">
					<div className="flex justify-end">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="min-h-11"
							onClick={onDiscard}
							disabled={!isDirty}
							title="Discarding asks for confirmation first."
						>
							Discard
						</Button>
					</div>
					{excludedAccounts.length + excludedPostings.length > 0 ? (
						<div className="space-y-2">
							<h3 className="type-value text-sm">Excluded</h3>
							{excludedAccounts.map((account) => (
								<PendingRow
									key={`excluded-account-${account.id}`}
									label={account.label}
									kind="Account"
									actionLabel="Restore"
									onAction={() => onRestoreAccount(account.id)}
								/>
							))}
							{excludedPostings.map((posting) => (
								<PendingRow
									key={`excluded-posting-${posting.id}`}
									label={posting.label}
									kind="Movement"
									actionLabel="Restore"
									onAction={() => onRestorePosting(posting.id)}
								/>
							))}
						</div>
					) : null}
					{addedAccounts.length + addedPostings.length > 0 ? (
						<div className="space-y-2">
							<h3 className="type-value text-sm">New</h3>
							{addedAccounts.map((account) => (
								<PendingRow
									key={`added-account-${account.id}`}
									label={account.label}
									kind="Account"
									actionLabel="Remove"
									onAction={() => onRemoveAccount(account.id)}
								/>
							))}
							{addedPostings.map((posting) => (
								<PendingRow
									key={`added-posting-${posting.id}`}
									label={posting.label}
									kind="Movement"
									actionLabel="Remove"
									onAction={() => onRemovePosting(posting.id)}
								/>
							))}
						</div>
					) : null}
					{modifiedAccounts.length + modifiedPostings.length > 0 ? (
						<div className="space-y-2">
							<h3 className="type-value text-sm">Modified</h3>
							{modifiedAccounts.map((account) => (
								<PendingRow
									key={`modified-account-${account.id}`}
									label={account.label}
									kind="Account"
									actionLabel="Remove"
									onAction={() => onRemoveAccount(account.id)}
								/>
							))}
							{modifiedPostings.map((posting) => (
								<PendingRow
									key={`modified-posting-${posting.id}`}
									label={posting.label}
									kind="Movement"
									actionLabel="Remove"
									onAction={() => onRemovePosting(posting.id)}
								/>
							))}
						</div>
					) : null}
					{removedAccounts.length + removedPostings.length > 0 ? (
						<div className="space-y-2">
							<h3 className="type-value text-sm">Removed</h3>
							{removedAccounts.map((account) => (
								<PendingRow
									key={`removed-account-${account.id}`}
									label={account.label}
									kind="Account"
								/>
							))}
							{removedPostings.map((posting) => (
								<PendingRow
									key={`removed-posting-${posting.id}`}
									label={posting.label}
									kind="Movement"
								/>
							))}
						</div>
					) : null}
					{checkpointChanges.length > 0 ? (
						<div className="space-y-2">
							<h3 className="type-value text-sm">Checkpoints</h3>
							{checkpointChanges.map((change) => (
								<PendingRow
									key={change.key}
									label={change.text}
									kind="Checkpoint"
								/>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function PendingRow({
	label,
	kind,
	actionLabel,
	onAction,
}: {
	label: string;
	kind: string;
	actionLabel?: string;
	onAction?: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 px-4 py-2">
			<span className="min-w-0">
				<span className="block truncate type-label">{label}</span>
				<span className="block type-caption">{kind}</span>
			</span>
			{actionLabel && onAction ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="min-h-11 shrink-0"
					onClick={onAction}
				>
					{actionLabel}
				</Button>
			) : null}
		</div>
	);
}
