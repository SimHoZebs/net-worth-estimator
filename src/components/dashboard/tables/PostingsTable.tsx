import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Collapsible } from "@/components/ui/collapsible-section";
import {
	DraftCommitInput,
	editableTableCellInputStyle,
} from "@/components/ui/draft-commit-input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableSearch } from "@/components/ui/table-search";
import { currency, formatDate, formatFrequency, pct } from "@/lib/format";
import { parseDecimalDraft } from "@/lib/number-draft";
import { isPastScheduledPosting } from "@/lib/posting-categories";
import {
	type Account,
	createExpressionAmount,
	type FinancialModelDocument,
	getExpression,
	type Posting,
	updateExpressionAmount,
} from "@/lib/projection";
import {
	findChangedIds,
	NO_CHANGED_IDS,
	SearchFooter,
	useTableSearch,
} from "./_shared";
import { PostingAmount } from "./PostingAmount";
import {
	TransactionListRow,
	transactionMatchesSearch,
} from "./TransactionPresentation";

export interface PostingsTableEditProps {
	displayDocument: FinancialModelDocument;
	document: FinancialModelDocument;
	isDirty: boolean;
	workingDocument: FinancialModelDocument | null;
	projectionStartDate: string;
	updatePosting: (id: string, changes: Partial<Posting>) => void;
	deletePosting: (id: string) => void;
	addPosting: (posting: Posting) => void;
}

export interface PostingsTableViewProps {
	postings: Posting[];
	accounts: Account[];
	projectionStartDate: string;
	showAdvanced: boolean;
}

export type PostingsTableProps =
	| ({ editable: true } & PostingsTableEditProps)
	| ({ editable?: false } & PostingsTableViewProps);

export function PostingsTable(props: PostingsTableProps) {
	if (props.editable === true) {
		const { editable, ...editProps } = props;
		return <EditablePostingsGrid {...editProps} />;
	}
	const { editable, ...viewProps } = props;
	return <ReadOnlyPostingsView {...viewProps} />;
}

function inputStyle(isDirty: boolean) {
	return editableTableCellInputStyle(isDirty);
}

interface NumericPostingInputProps {
	label: string;
	value: number | null;
	isDirty: boolean;
	nullable?: boolean;
	min?: number;
	step?: number;
	onCommit: (value: number | null) => void;
}

function NumericPostingInput({
	label,
	value,
	isDirty,
	nullable = false,
	min,
	step,
	onCommit,
}: NumericPostingInputProps) {
	const committedValue = value === null ? "" : String(value);
	return (
		<DraftCommitInput
			aria-label={label}
			className={inputStyle(isDirty)}
			type="number"
			min={min}
			step={step}
			committedValue={committedValue}
			onCommitDraft={(draft) => {
				const trimmed = draft.trim();
				if (!trimmed && nullable) {
					onCommit(null);
					return "";
				}
				const parsed = parseDecimalDraft(trimmed);
				if (parsed === null) return null;
				const nextValue = min === undefined ? parsed : Math.max(min, parsed);
				onCommit(nextValue);
				return String(nextValue);
			}}
		/>
	);
}

function ExpressionPostingInput({
	posting,
	isDirty,
	onCommit,
}: {
	posting: Posting;
	isDirty: boolean;
	onCommit: (amount: Posting["amount"]) => void;
}) {
	const committedValue = getExpression(posting) ?? "";
	return (
		<DraftCommitInput
			aria-label={`${posting.label} amount expression`}
			className={inputStyle(isDirty)}
			committedValue={committedValue}
			onCommitDraft={(draft) => {
				try {
					onCommit(updateExpressionAmount(posting.amount, draft));
					return draft;
				} catch {
					return null;
				}
			}}
		/>
	);
}

function EditablePostingsGrid({
	displayDocument,
	document,
	isDirty,
	workingDocument,
	projectionStartDate,
	updatePosting,
	deletePosting,
	addPosting,
}: PostingsTableEditProps) {
	const originalPostingById = useMemo(
		() => new Map(document.postings.map((posting) => [posting.id, posting])),
		[document.postings],
	);
	const changedPostingIds = useMemo(() => {
		if (!isDirty || workingDocument === null) return NO_CHANGED_IDS;
		return findChangedIds(
			originalPostingById,
			workingDocument.postings,
			isDirty,
		);
	}, [isDirty, workingDocument, originalPostingById]);

	return (
		<Card className="rounded-[1.8rem] border-border shadow-sm ">
			<CardHeader>
				<CardTitle>Posting definitions</CardTitle>
				<CardDescription>
					Edit the canonical amount calculations and scheduling fields.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>ID</TableHead>
							<TableHead>Label</TableHead>
							<TableHead>Source</TableHead>
							<TableHead>Destinations</TableHead>
							<TableHead>Amount calculation</TableHead>
							<TableHead>Freq</TableHead>
							<TableHead>Rate</TableHead>
							<TableHead>Growth</TableHead>
							<TableHead>Vol</TableHead>
							<TableHead>Start</TableHead>
							<TableHead>End</TableHead>
							<TableHead>Cap</TableHead>
							<TableHead>Pri</TableHead>
							<TableHead>Enabled</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{displayDocument.postings.map((p) => {
							const changed = changedPostingIds.has(p.id);
							return (
								<TableRow key={p.id}>
									<TableCell>
										<DraftCommitInput
											aria-label={`Posting ID for ${p.label}`}
											className={inputStyle(!!changed)}
											committedValue={p.id}
											onCommitDraft={(id) => {
												updatePosting(p.id, { id });
												return id;
											}}
										/>
									</TableCell>
									<TableCell>
										<input
											aria-label={`Posting label for ${p.id}`}
											className={inputStyle(!!changed)}
											value={p.label}
											onChange={(e) =>
												updatePosting(p.id, { label: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											aria-label={`${p.label} source account`}
											className={inputStyle(!!changed)}
											value={p.sourceAccountId ?? ""}
											onChange={(e) =>
												updatePosting(p.id, {
													sourceAccountId: e.target.value || null,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											aria-label={`${p.label} destination accounts`}
											className={inputStyle(!!changed)}
											value={p.destinations?.join(";") ?? ""}
											onChange={(e) => {
												const raw = e.target.value;
												updatePosting(p.id, {
													destinations: raw.trim()
														? raw.split(";").map((s) => s.trim())
														: null,
												});
											}}
										/>
									</TableCell>
									<TableCell>
										{getExpression(p) !== null ? (
											<ExpressionPostingInput
												posting={p}
												isDirty={!!changed}
												onCommit={(amount) => updatePosting(p.id, { amount })}
											/>
										) : (
											<PostingAmount posting={p} showDetails />
										)}
									</TableCell>
									<TableCell>
										<select
											aria-label={`${p.label} frequency`}
											className={inputStyle(!!changed)}
											value={p.frequency}
											onChange={(e) => {
												const frequency = e.target
													.value as Posting["frequency"];
												updatePosting(p.id, { frequency });
											}}
										>
											<option value="once">once</option>
											<option value="daily">daily</option>
											<option value="weekly">weekly</option>
											<option value="monthly">monthly</option>
											<option value="quarterly">quarterly</option>
											<option value="annual">annual</option>
										</select>
									</TableCell>
									<TableCell>
										<NumericPostingInput
											label={`${p.label} annual rate`}
											isDirty={!!changed}
											step={0.01}
											value={p.annualRate}
											onCommit={(annualRate) =>
												updatePosting(p.id, {
													annualRate: annualRate ?? p.annualRate,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<NumericPostingInput
											label={`${p.label} annual growth rate`}
											isDirty={!!changed}
											step={0.01}
											value={p.annualGrowthRate}
											onCommit={(annualGrowthRate) =>
												updatePosting(p.id, {
													annualGrowthRate:
														annualGrowthRate ?? p.annualGrowthRate,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<NumericPostingInput
											label={`${p.label} volatility`}
											isDirty={!!changed}
											min={0}
											step={0.01}
											value={p.volatility}
											onCommit={(volatility) =>
												updatePosting(p.id, {
													volatility: volatility ?? p.volatility,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											aria-label={`${p.label} start date`}
											className={inputStyle(!!changed)}
											value={p.startDate}
											onChange={(e) =>
												updatePosting(p.id, { startDate: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											aria-label={`${p.label} end date`}
											className={inputStyle(!!changed)}
											value={p.endDate ?? ""}
											disabled={p.frequency === "once"}
											onChange={(e) =>
												updatePosting(p.id, { endDate: e.target.value || null })
											}
										/>
									</TableCell>
									<TableCell>
										<NumericPostingInput
											label={`${p.label} annual cap`}
											isDirty={!!changed}
											nullable
											min={0}
											value={p.annualCap}
											onCommit={(annualCap) =>
												updatePosting(p.id, { annualCap })
											}
										/>
									</TableCell>
									<TableCell>
										<NumericPostingInput
											label={`${p.label} priority`}
											isDirty={!!changed}
											min={1}
											value={p.priority}
											onCommit={(priority) =>
												updatePosting(p.id, {
													priority: priority ?? p.priority,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											type="checkbox"
											aria-label={`Enable posting ${p.label}`}
											className="h-4 w-4 rounded accent-primary"
											checked={p.enabled}
											onChange={() =>
												updatePosting(p.id, { enabled: !p.enabled })
											}
										/>
									</TableCell>
									<TableCell>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => deletePosting(p.id)}
											aria-label={`Delete posting ${p.label}`}
										>
											✕
										</Button>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
				<div className="mt-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() =>
							addPosting({
								id: `new-posting-${Date.now()}`,
								label: "New posting",
								sourceAccountId: null,
								destinations: null,
								amount: createExpressionAmount("0"),
								frequency: "monthly",
								annualRate: 0,
								annualGrowthRate: 0,
								volatility: 0,
								startDate: projectionStartDate,
								endDate: null,
								annualCap: null,
								priority: 1,
								enabled: true,
							})
						}
					>
						+ Add posting
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ReadOnlyPostingsView({
	postings,
	accounts,
	projectionStartDate,
	showAdvanced,
}: PostingsTableViewProps) {
	const { search, setSearch, query } = useTableSearch();
	const accountById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	const visiblePostings = useMemo(() => {
		return postings.filter((posting) =>
			transactionMatchesSearch(posting, accountById, query),
		);
	}, [postings, query, accountById]);
	const currentPostings = visiblePostings.filter(
		(posting) => !isPastScheduledPosting(posting, projectionStartDate),
	);
	const pastPostings = visiblePostings.filter((posting) =>
		isPastScheduledPosting(posting, projectionStartDate),
	);

	return (
		<div className="space-y-4">
			<div>
				<h2 className="type-title">Scheduled transactions</h2>
				<p className="type-caption">
					Recurring money in, money out, and transfers.
				</p>
			</div>
			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search scheduled transactions..."
			/>
			{currentPostings.length > 0 ? (
				<PostingRows
					postings={currentPostings}
					accountById={accountById}
					showAdvanced={showAdvanced}
				/>
			) : (
				<div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center type-muted">
					No current scheduled transactions match this search.
				</div>
			)}
			{pastPostings.length > 0 ? (
				<Collapsible className="!rounded-2xl !border-border/70 !bg-surface/55 !p-0 !shadow-none !backdrop-blur-none">
					<Collapsible.Trigger className="flex items-center justify-between gap-3 px-4 py-3 type-label text-muted-foreground hover:text-foreground">
						<span>
							Past scheduled transactions · {pastPostings.length} transaction
							{pastPostings.length === 1 ? "" : "s"}
						</span>
						<Collapsible.Chevron />
					</Collapsible.Trigger>
					<Collapsible.Content className="!mt-0 border-t border-border/70">
						<PostingRows
							postings={pastPostings}
							accountById={accountById}
							showAdvanced={showAdvanced}
							borderless
						/>
					</Collapsible.Content>
				</Collapsible>
			) : null}
			<SearchFooter
				count={currentPostings.length}
				singular="current transaction"
				plural="current transactions"
			/>
		</div>
	);
}

function PostingRows({
	postings,
	accountById,
	showAdvanced,
	borderless = false,
}: {
	postings: Posting[];
	accountById: ReadonlyMap<string, Account>;
	showAdvanced: boolean;
	borderless?: boolean;
}) {
	return (
		<div
			className={`divide-y divide-border/60 bg-card/70 ${borderless ? "rounded-b-2xl" : "rounded-2xl border border-border/80"}`}
		>
			{postings.map((posting) => (
				<TransactionListRow
					key={posting.id}
					posting={posting}
					accountById={accountById}
					showCalculationDetails
					meta={<Schedule posting={posting} />}
					technical={
						showAdvanced ? <TechnicalDetails posting={posting} /> : null
					}
				/>
			))}
		</div>
	);
}

function Schedule({ posting }: { posting: Posting }) {
	return (
		<>
			{formatFrequency(posting.frequency)} from {formatDate(posting.startDate)}
			{posting.endDate ? ` through ${formatDate(posting.endDate)}` : ""}
		</>
	);
}

function TechnicalDetails({ posting }: { posting: Posting }) {
	const assumptions = [
		posting.annualRate ? `${pct.format(posting.annualRate)} rate` : null,
		posting.annualGrowthRate
			? `${pct.format(posting.annualGrowthRate)} growth`
			: null,
		posting.volatility ? `${pct.format(posting.volatility)} volatility` : null,
		posting.annualCap !== null
			? `${currency.format(posting.annualCap)} cap`
			: null,
		`priority ${posting.priority}`,
	].filter(Boolean);
	return (
		<div>
			<div>
				{posting.id} · {assumptions.join(" · ")}
			</div>
			<details className="mt-1">
				<summary className="cursor-pointer select-none type-caption">
					Raw amount configuration
				</summary>
				<pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/70 p-2 type-code">
					{JSON.stringify(posting.amount, null, 2)}
				</pre>
			</details>
		</div>
	);
}
