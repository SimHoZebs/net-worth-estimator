import { useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { EmptyState, SectionCard } from "@/components/present/present";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { currency, formatDate, pluralize } from "@/lib/format";
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
import {
	type MoneyDirection,
	moneyDirection,
	slugId,
	touchesAccount,
} from "./banking/money";
import { DateText } from "./dashboard/tables/primitives/formatting";
import { ModelValidationPanel } from "./ModelValidationPanel";

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

	const filterByAccount = (postings: Posting[]) =>
		selectedAccountId
			? postings.filter((posting) =>
					touchesAccount(posting, selectedAccountId, accountIds),
				)
			: postings;

	const scheduledPostings = filterByAccount(
		postingGroups.scheduledTransactions,
	);
	const historyPostings = filterByAccount(postingGroups.transactionHistory);
	const rulesPostings = filterByAccount(postingGroups.accountRules);
	const visibleCheckpoints = selectedAccountId
		? (displayDocument?.checkpoints.filter(
				(checkpoint) => checkpoint.AccountId === selectedAccountId,
			) ?? [])
		: (displayDocument?.checkpoints ?? []);
	const visibleIssues = selectedAccountId
		? issues.filter((issue) => issue.path.includes(selectedAccountId))
		: issues;

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

	const tabs: { id: InputSection; label: string; count: number }[] = [
		{
			id: "accounts",
			label: "Accounts",
			count: displayDocument?.accounts.length ?? 0,
		},
		{
			id: "scheduled",
			label: "Scheduled",
			count: postingGroups.scheduledTransactions.length,
		},
		{
			id: "activity",
			label: "Activity",
			count: postingGroups.transactionHistory.length,
		},
		{
			id: "reconcile",
			label: "Reconcile",
			count: displayDocument?.checkpoints.length ?? 0,
		},
	];

	const lastLoaded =
		dataUpdatedAt === 0
			? "Not loaded"
			: new Date(dataUpdatedAt).toLocaleString();

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

	const selectedAccount = selectedAccountId
		? accountById.get(selectedAccountId)
		: null;

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
					<Button
						type="button"
						variant="ghost"
						size="sm"
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
							onClick={() => setAccountForm({ mode: "create" })}
						>
							Add account
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

			<p className="type-caption text-muted-foreground">
				{source.label} · Last loaded {lastLoaded}
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
							<legend className="sr-only">Model input sections</legend>
							{tabs.map((tab) => (
								<button
									key={tab.id}
									type="button"
									aria-pressed={activeSection === tab.id}
									onClick={() => {
										setActiveSection(tab.id);
										setDetailPostingId(null);
										setMoneyForm(null);
									}}
									className={tabClassName(activeSection === tab.id)}
								>
									{tab.label} <span className="opacity-70">{tab.count}</span>
								</button>
							))}
						</fieldset>
					</div>

					<AccountPicker
						accounts={displayDocument.accounts}
						selectedAccountId={selectedAccountId}
						onSelect={setSelectedAccountId}
					/>

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
								accountById={accountById}
								latestCheckpointFor={(accountId) =>
									displayDocument.checkpoints
										.filter((c) => c.AccountId === accountId)
										.sort((a, b) => b.Date.localeCompare(a.Date))[0] ?? null
								}
								onOpenPosting={(posting) => setDetailPostingId(posting.id)}
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
								}}
								onAddAccount={() => setAccountForm({ mode: "create" })}
							/>
						) : null}

						{activeSection === "scheduled" ? (
							<ScheduledView
								postings={scheduledPostings}
								total={postingGroups.scheduledTransactions.length}
								accounts={displayDocument.accounts}
								projectionStartDate={projectionStartDate}
								selectedLabel={
									selectedAccountId
										? (accountById.get(selectedAccountId)?.label ??
											selectedAccountId)
										: null
								}
								onClearFilter={() => setSelectedAccountId(null)}
								onOpen={(posting) => setDetailPostingId(posting.id)}
								onAdd={() => openCreate("transfer")}
							/>
						) : null}

						{activeSection === "activity" ? (
							<div className="space-y-3">
								{selectedAccountId ? (
									<FilterNotice
										text={`Filtered by ${accountById.get(selectedAccountId)?.label ?? selectedAccountId} · ${historyPostings.length} of ${postingGroups.transactionHistory.length}`}
										onClear={() => setSelectedAccountId(null)}
									/>
								) : null}
								<MoneyFeed
									postings={historyPostings}
									accounts={displayDocument.accounts}
									emptyText="No past activity."
									onOpen={(posting) => setDetailPostingId(posting.id)}
									groupByDate
									dateDescending
								/>
							</div>
						) : null}

						{activeSection === "reconcile" ? (
							<div className="space-y-4">
								{selectedAccountId ? (
									<FilterNotice
										text={`Reconcile filtered by ${accountById.get(selectedAccountId)?.label ?? selectedAccountId} · ${visibleCheckpoints.length} of ${displayDocument.checkpoints.length} statements, ${visibleIssues.length} of ${issues.length} diagnostics`}
										onClear={() => setSelectedAccountId(null)}
									/>
								) : null}
								{visibleIssues.length > 0 ? (
									<ModelValidationPanel issues={visibleIssues} />
								) : selectedAccountId ? (
									<p className="type-caption text-muted-foreground">
										No diagnostics mention this account. Overall validation:{" "}
										{validationSummary}.
									</p>
								) : null}
								<StatementsView
									accounts={displayDocument.accounts}
									checkpoints={visibleCheckpoints}
									filtered={selectedAccountId !== null}
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
					No financial model loaded yet.
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
					onDiscard={cancelEditing}
					addedAccounts={addedAccounts}
					addedPostings={addedPostings}
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
		{ label: "Pay", hint: "money out", onClick: onPay },
		{ label: "Transfer", hint: "move it", onClick: onTransfer },
		{ label: "Receive", hint: "money in", onClick: onReceive },
		{ label: "Verify", hint: "check balance", onClick: onVerify },
	];
	return (
		<div className="grid grid-cols-4 gap-2">
			{actions.map((action) => (
				<button
					key={action.label}
					type="button"
					onClick={action.onClick}
					className="rounded-2xl border border-border/80 bg-card/85 px-2 py-3 text-center transition hover:border-ring hover:shadow-sm"
				>
					<span className="block type-value text-sm">{action.label}</span>
					<span className="block type-caption">{action.hint}</span>
				</button>
			))}
		</div>
	);
}

function AccountPicker({
	accounts,
	selectedAccountId,
	onSelect,
}: {
	accounts: Account[];
	selectedAccountId: string | null;
	onSelect: (id: string | null) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-surface/55 px-3 py-2">
			<label className="type-caption" htmlFor="account-context">
				Viewing
			</label>
			<select
				id="account-context"
				className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 type-caption sm:max-w-xs"
				value={selectedAccountId ?? ""}
				onChange={(event) => onSelect(event.target.value || null)}
			>
				<option value="">Everything</option>
				{accounts.map((account) => (
					<option key={account.id} value={account.id}>
						{account.label}
					</option>
				))}
			</select>
			{selectedAccountId ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onSelect(null)}
				>
					Clear
				</Button>
			) : null}
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
	accountById,
	latestCheckpointFor,
	onOpenPosting,
	onEditAccount,
	onDeleteAccount,
	onVerify,
	onExcludeAccount,
	onAddAccount,
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
	accountById: ReadonlyMap<string, Account>;
	latestCheckpointFor: (
		accountId: string,
	) => { Date: string; Balance: number } | null;
	onOpenPosting: (posting: Posting) => void;
	onEditAccount: (account: Account) => void;
	onDeleteAccount: (account: Account) => void;
	onVerify: (accountId: string) => void;
	onExcludeAccount: (id: string) => void;
	onAddAccount: () => void;
}) {
	const normalized = accountQuery.trim().toLowerCase();
	const matching = accounts.filter(
		(account) =>
			!normalized ||
			account.label.toLowerCase().includes(normalized) ||
			account.id.toLowerCase().includes(normalized),
	);
	const balanceRows = matching.map((account) => ({
		account,
		balance: balanceOf(account.id),
	}));
	const assets = balanceRows.filter(
		(row) => row.balance !== null && row.balance >= 0,
	);
	const debts = balanceRows.filter(
		(row) => row.balance !== null && row.balance < 0,
	);
	const unknown = balanceRows.filter((row) => row.balance === null);
	const assetsTotal = assets.reduce((sum, row) => sum + (row.balance ?? 0), 0);
	const debtsTotal = debts.reduce((sum, row) => sum + (row.balance ?? 0), 0);
	const selected = selectedAccountId
		? accountById.get(selectedAccountId)
		: null;

	return (
		<div className="space-y-4">
			<section className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-gradient-to-br from-card via-card to-surface/70">
				<div className="border-b border-border/70 p-5">
					<div className="type-eyebrow text-primary">Total balance</div>
					<div className="mt-1 type-metric text-foreground">
						{balancesAvailable && currentNetWorth !== null
							? currency.format(currentNetWorth)
							: "—"}
					</div>
					<p className="mt-1 type-muted">
						After recorded activity through{" "}
						<DateText value={projectionStartDate} />.
					</p>
				</div>
				<div className="grid grid-cols-2 divide-x divide-border/70">
					<div className="px-5 py-4">
						<div className="type-label">Cash & assets</div>
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

			<input
				type="search"
				value={accountQuery}
				onChange={(event) => onQuery(event.target.value)}
				placeholder="Search accounts…"
				aria-label="Search accounts"
				className="w-full rounded-full border border-border bg-card px-4 py-2 type-body placeholder:text-muted-foreground sm:max-w-xs"
			/>

			{[
				{ title: "Cash & assets", rows: assets },
				{ title: "Owed", rows: debts },
				...(unknown.length > 0
					? [{ title: "Waiting on balances", rows: unknown }]
					: []),
			].map((group) => (
				<section key={group.title} aria-label={group.title}>
					<h3 className="mb-2 px-1 type-label text-muted-foreground">
						{group.title}
					</h3>
					{group.rows.length === 0 ? (
						<p className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-center type-muted">
							Nothing here.
						</p>
					) : (
						<div className="grid gap-2 sm:grid-cols-2">
							{group.rows.map(({ account, balance }) => {
								const rules = rulesFor(account.id);
								const isSelected = selectedAccountId === account.id;
								return (
									<button
										key={account.id}
										type="button"
										aria-pressed={isSelected}
										onClick={() => onSelect(isSelected ? null : account.id)}
										className={`rounded-2xl border p-4 text-left transition ${
											isSelected
												? "border-primary bg-primary-subtle shadow-sm"
												: "border-border/80 bg-card/70 hover:border-ring"
										}`}
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
										<span className="mt-1 block type-caption">
											{rules.length} rule{rules.length === 1 ? "" : "s"}
										</span>
									</button>
								);
							})}
						</div>
					)}
				</section>
			))}

			{selected ? (
				<AccountDetail
					account={selected}
					balance={balanceOf(selected.id)}
					rules={rulesFor(selected.id)}
					accountById={accountById}
					latestCheckpoint={latestCheckpointFor(selected.id)}
					onOpenPosting={onOpenPosting}
					onEdit={() => onEditAccount(selected)}
					onDelete={() => onDeleteAccount(selected)}
					onVerify={() => onVerify(selected.id)}
					onExclude={() => onExcludeAccount(selected.id)}
					onClose={() => onSelect(null)}
				/>
			) : (
				<div className="flex justify-center">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onAddAccount}
					>
						Add an account
					</Button>
				</div>
			)}
		</div>
	);
}

function AccountDetail({
	account,
	balance,
	rules,
	accountById,
	latestCheckpoint,
	onOpenPosting,
	onEdit,
	onDelete,
	onVerify,
	onExclude,
	onClose,
}: {
	account: Account;
	balance: number | null;
	rules: Posting[];
	accountById: ReadonlyMap<string, Account>;
	latestCheckpoint: { Date: string; Balance: number } | null;
	onOpenPosting: (posting: Posting) => void;
	onEdit: () => void;
	onDelete: () => void;
	onVerify: () => void;
	onExclude: () => void;
	onClose: () => void;
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	return (
		<section
			aria-label={`${account.label} details`}
			className="space-y-3 rounded-[1.6rem] border border-border/80 bg-card/70 p-5"
		>
			<div className="flex items-center gap-3">
				<MoneyAvatar
					label={account.label}
					color={account.color}
					direction="transfer"
				/>
				<div className="min-w-0 flex-1">
					<h3 className="truncate type-title text-lg">{account.label}</h3>
					<p className="type-caption">
						{balance === null ? "Balance pending" : currency.format(balance)}
						{latestCheckpoint
							? ` · Verified ${formatDate(latestCheckpoint.Date)} at ${currency.format(latestCheckpoint.Balance)}`
							: " · Never verified"}
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" onClick={onClose}>
					Close
				</Button>
			</div>

			<div className="flex flex-wrap gap-2">
				<Button type="button" variant="secondary" size="sm" onClick={onEdit}>
					Edit account
				</Button>
				<Button type="button" variant="secondary" size="sm" onClick={onVerify}>
					Verify balance
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onExclude}>
					Exclude
				</Button>
				{confirmingDelete ? (
					<Button
						type="button"
						variant="destructive"
						size="sm"
						onClick={onDelete}
					>
						Confirm delete
					</Button>
				) : (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setConfirmingDelete(true)}
					>
						Delete
					</Button>
				)}
			</div>

			<div>
				<h4 className="mb-1.5 px-1 type-label text-muted-foreground">
					Rules touching this account
				</h4>
				{rules.length === 0 ? (
					<p className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-center type-muted">
						No rules touch this account yet.
					</p>
				) : (
					<div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
						{rules.map((posting) => (
							<div key={posting.id} className="flex items-center gap-2 pr-2">
								<div className="min-w-0 flex-1">
									<MoneyRowInline
										posting={posting}
										accountById={accountById}
										onOpen={onOpenPosting}
									/>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</section>
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
	total,
	accounts,
	projectionStartDate,
	selectedLabel,
	onClearFilter,
	onOpen,
	onAdd,
}: {
	postings: Posting[];
	total: number;
	accounts: Account[];
	projectionStartDate: string;
	selectedLabel: string | null;
	onClearFilter: () => void;
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
			{selectedLabel ? (
				<FilterNotice
					text={`Filtered by ${selectedLabel} · ${postings.length} of ${total}`}
					onClear={onClearFilter}
				/>
			) : null}
			<div className="flex justify-end">
				<Button type="button" variant="secondary" size="sm" onClick={onAdd}>
					New scheduled payment
				</Button>
			</div>
			<div>
				<h3 className="mb-1.5 px-1 type-label text-muted-foreground">
					Upcoming
				</h3>
				<MoneyFeed
					postings={current}
					accounts={accounts}
					emptyText="Nothing scheduled."
					onOpen={onOpen}
					dateDescending={false}
				/>
			</div>
			{past.length > 0 ? (
				<details className="rounded-2xl border border-border/70">
					<summary className="cursor-pointer px-4 py-3 type-label text-muted-foreground">
						Ended · {past.length}
					</summary>
					<div className="border-t border-border/70 p-3">
						<MoneyFeed
							postings={past}
							accounts={accounts}
							emptyText="No ended schedules."
							onOpen={onOpen}
							dateDescending={false}
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
	filtered,
	balanceOf,
	onVerify,
	onDelete,
}: {
	accounts: Account[];
	checkpoints: { Date: string; AccountId: string; Balance: number }[];
	filtered: boolean;
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
		.filter((account) => !filtered || byAccount.has(account.id))
		.sort((a, b) => a.label.localeCompare(b.label));

	return (
		<div className="space-y-3">
			<div className="flex justify-end">
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => onVerify(null)}
				>
					Verify a balance
				</Button>
			</div>
			{ordered.length === 0 ? (
				<p className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center type-muted">
					No statements for this filter.
				</p>
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
									onClick={() => onVerify(account.id)}
								>
									Verify
								</Button>
							</div>
							<p className="mt-1 type-caption">
								{latest
									? `Verified ${formatDate(latest.Date)} at ${currency.format(latest.Balance)}`
									: "Never verified"}
								{modeled !== null
									? ` · Model says ${currency.format(modeled)}`
									: ""}
							</p>
							{rows.length > 0 ? (
								<ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
									{rows.map((row) => (
										<li
											key={`${row.AccountId}:${row.Date}`}
											className="flex items-center justify-between gap-3 px-3 py-2"
										>
											<span className="type-body text-sm">
												{formatDate(row.Date)} · {currency.format(row.Balance)}
												<span className="type-caption">
													{" "}
													· {labelById.get(row.AccountId) ?? row.AccountId}
												</span>
											</span>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => onDelete(row.AccountId, row.Date)}
											>
												Remove
											</Button>
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
	excludedAccounts: Account[];
	excludedPostings: Posting[];
	onRestoreAccount: (id: string) => void;
	onRestorePosting: (id: string) => void;
	onRemoveAccount: (id: string) => void;
	onRemovePosting: (id: string) => void;
}) {
	if (count === 0 && !isDirty) return null;
	return (
		<div className="space-y-3">
			<div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
				<span className="type-caption">
					{count > 0
						? `${count} unsaved change${count === 1 ? "" : "s"} waiting.`
						: "Editing. Changes stage here until saved."}
				</span>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={onToggle}
					>
						{open ? "Hide review" : "Review"}
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={onSave}
						disabled={!isDirty || !saveLabel || isSaving}
					>
						{isSaving ? "Saving..." : (saveLabel ?? "Save unavailable")}
					</Button>
				</div>
			</div>
			{open ? (
				<div className="space-y-4 rounded-2xl border border-border/70 p-4">
					<div className="flex justify-end">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={onDiscard}
							disabled={!isDirty}
						>
							Discard draft
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
							<h3 className="type-value text-sm">New in this draft</h3>
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
					) : (
						<p className="type-caption text-muted-foreground">
							Edits to existing rows count here too — open the row to change it
							back, or discard the whole draft.
						</p>
					)}
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
	actionLabel: string;
	onAction: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 px-4 py-2">
			<span className="min-w-0">
				<span className="block truncate type-label">{label}</span>
				<span className="block type-caption">{kind}</span>
			</span>
			<Button type="button" variant="ghost" size="sm" onClick={onAction}>
				{actionLabel}
			</Button>
		</div>
	);
}

export function FilterNotice({
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
