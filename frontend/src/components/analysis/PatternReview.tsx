import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupPatternReviews,
	reviewChips,
	reviewSummary,
	reviewTitle,
	type PatternReviewRow,
	type PatternReviewTab,
} from "@/domain/patternReview.ts";
import {
	paymentStatus,
	type PaymentPattern,
} from "@/domain/paymentFindings.ts";
import {
	recurringPatternStatus,
	type RecurringPattern,
} from "@/domain/recurringPatterns.ts";
import {
	useDismissAnalysisFinding,
	useReviewAnalysisFinding,
} from "@/state/analyses.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { itemVariants } from "@/components/ui/item.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs.tsx";

import {
	AnalysisDialogContent,
	analysisErrorClassName,
	FORECAST_SCHEDULE_EYEBROW,
	FORECAST_SCHEDULE_LINK_HEADING,
	ForecastScheduleActions,
} from "./RecurringPatterns.tsx";

const forecastScheduleTitles = {
	eyebrow: FORECAST_SCHEDULE_EYEBROW,
	heading: FORECAST_SCHEDULE_LINK_HEADING,
};

function answerInput(finding: AnalysisFinding, action: "confirm" | "reject") {
	return {
		id: finding.id,
		input: {
			requestId: crypto.randomUUID(),
			runId: finding.runId,
			revision: finding.feedbackRevision,
			action,
		},
	};
}

const TABS: { id: PatternReviewTab; label: string; empty: string }[] = [
	{ id: "review", label: "Review", empty: "No patterns need review." },
	{ id: "saved", label: "Saved", empty: "No saved patterns." },
	{ id: "dismissed", label: "Dismissed", empty: "No dismissed patterns." },
];

function ClassificationAnswers({
	pattern,
	title,
	readOnly,
}: {
	pattern: PaymentPattern;
	title: string;
	readOnly: boolean;
}) {
	const review = useReviewAnalysisFinding();
	const finding = pattern.anchor;
	const confirmed = finding.review?.decision === "confirmed";
	const rejected = finding.review?.decision === "rejected";
	const inactive = finding.stale || finding.status === "withdrawn";
	const busy = review.isPending;
	const kindLabel =
		finding.kind.charAt(0).toUpperCase() + finding.kind.slice(1);
	return (
		<div className="space-y-2">
			<p className="m-0 text-xs font-semibold">{kindLabel}</p>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={confirmed ? "success" : "secondary"}>
					{paymentStatus(finding)}
				</Badge>
			</div>
			{review.isError && (
				<p role="alert" className={analysisErrorClassName}>
					The answer could not be saved.
				</p>
			)}
			{!readOnly && (
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						variant="default"
						disabled={busy || inactive || confirmed}
						aria-pressed={confirmed}
						aria-label={`Confirm ${finding.kind} for ${title}`}
						onClick={() => review.mutate(answerInput(finding, "confirm"))}
					>
						Confirm
					</Button>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={busy || inactive || rejected}
						aria-pressed={rejected}
						aria-label={`Not ${finding.kind} for ${title}`}
						onClick={() => review.mutate(answerInput(finding, "reject"))}
					>
						Not {finding.kind}
					</Button>
				</div>
			)}
		</div>
	);
}

function RepetitionActions({
	pattern,
	title,
	names,
	readOnly,
}: {
	pattern: RecurringPattern;
	title: string;
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const feedback = useReviewAnalysisFinding();
	const dismiss = useDismissAnalysisFinding();
	const confirmed = pattern.confirmed;
	const rejected = pattern.anchor.review?.decision === "rejected";
	const actionable = confirmed ?? pattern.anchor;
	return (
		<div className="space-y-2">
			<p className="m-0 text-xs font-semibold">Repeating</p>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={confirmed ? "success" : "secondary"}>
					{recurringPatternStatus(pattern)}
				</Badge>
			</div>
			{(feedback.isError || dismiss.isError) && (
				<p role="alert" className={analysisErrorClassName}>
					The answer could not be saved.
				</p>
			)}
			<ForecastScheduleActions
				findingId={actionable.id}
				title={title}
				names={names}
				readOnly={readOnly}
				titles={forecastScheduleTitles}
				before={
					!readOnly && rejected ? (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={dismiss.isPending}
							aria-label={`Review repeating pattern for ${title} again`}
							onClick={() =>
								dismiss.mutate({ id: pattern.anchor.id, dismissed: false })
							}
						>
							Review again
						</Button>
					) : undefined
				}
				after={
					!readOnly && !confirmed && !rejected ? (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={feedback.isPending}
							aria-label={`Reject repeating pattern for ${title}`}
							onClick={() =>
								feedback.mutate(answerInput(pattern.anchor, "reject"))
							}
						>
							Not repeating
						</Button>
					) : undefined
				}
			/>
		</div>
	);
}

function PatternReviewDialog({
	row,
	names,
	readOnly,
	onClose,
}: {
	row: PatternReviewRow;
	names: Map<string, string>;
	readOnly: boolean;
	onClose: () => void;
}) {
	const visibility = useDismissAnalysisFinding();
	const title = useMemo(() => reviewTitle(row, names), [row, names]);
	const summary = useMemo(() => reviewSummary(row), [row]);
	const { visible, dismissed } = useMemo(() => {
		const visible = row.findings.filter((finding) => !finding.dismissed);
		const dismissed = row.findings.filter((finding) => finding.dismissed);
		return { visible, dismissed };
	}, [row]);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<AnalysisDialogContent>
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
						Pattern review
					</p>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1">
						<p className="m-0 text-xs text-muted-foreground">
							{summary.cadence} · {summary.recorded} recorded
						</p>
						{summary.amount && (
							<p
								className={
									summary.amount.inflow
										? "m-0 text-xs font-semibold text-success-text"
										: "m-0 text-xs font-semibold"
								}
							>
								{summary.amount.text} · {summary.amount.direction}
							</p>
						)}
					</div>
					{row.payments.map((pattern) => (
						<ClassificationAnswers
							key={pattern.key}
							pattern={pattern}
							title={title}
							readOnly={readOnly}
						/>
					))}
					{row.repetition.map((pattern, index) => (
						<RepetitionActions
							key={`${pattern.key}:${index}`}
							pattern={pattern}
							title={title}
							names={names}
							readOnly={readOnly}
						/>
					))}
					{row.repetition.length === 0 &&
						row.payments.map((pattern) => (
							<ForecastScheduleActions
								key={`forecast:${pattern.key}`}
								findingId={pattern.anchor.id}
								title={title}
								names={names}
								readOnly={readOnly}
								titles={forecastScheduleTitles}
							/>
						))}
					{visibility.isError && (
						<p role="alert" className={analysisErrorClassName}>
							The answer could not be saved.
						</p>
					)}
					{!readOnly && (
						<div className="flex flex-wrap gap-2">
							{visible.length > 0 && (
								<Button
									type="button"
									size="sm"
									variant="secondary"
									disabled={visibility.isPending}
									aria-label={`Dismiss pattern for ${title}`}
									onClick={() => {
										for (const finding of visible)
											visibility.mutate({ id: finding.id, dismissed: true });
									}}
								>
									Dismiss
								</Button>
							)}
							{dismissed.length > 0 && (
								<Button
									type="button"
									size="sm"
									variant="secondary"
									disabled={visibility.isPending}
									aria-label={`Restore pattern for ${title}`}
									onClick={() => {
										for (const finding of dismissed)
											visibility.mutate({ id: finding.id, dismissed: false });
									}}
								>
									Restore
								</Button>
							)}
						</div>
					)}
				</div>
			</AnalysisDialogContent>
		</Dialog>
	);
}

export function PatternReview({
	findings,
	names,
	readOnly,
}: {
	findings: AnalysisFinding[];
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const [rows, setRows] = useState(5);
	const [openKey, setOpenKey] = useState<string | null>(null);
	const groups = useMemo(() => groupPatternReviews(findings), [findings]);
	const counts = useMemo(() => {
		const next = new Map<PatternReviewTab, number>();
		for (const row of groups) next.set(row.tab, (next.get(row.tab) ?? 0) + 1);
		return next;
	}, [groups]);
	const rowViews = useMemo(
		() =>
			groups.map((row) => ({
				row,
				title: reviewTitle(row, names),
				summary: reviewSummary(row),
				chips: reviewChips(row),
			})),
		[groups, names],
	);
	const openRow = useMemo(
		() =>
			openKey
				? (rowViews.find((view) => view.row.key === openKey)?.row ?? null)
				: null,
		[rowViews, openKey],
	);
	if (!groups.length) return null;
	return (
		<section className="space-y-4" aria-label="Pattern review">
			<header className="space-y-2">
				<h2 className="m-0 text-lg font-semibold">Pattern review</h2>
				<p className="m-0 text-sm text-muted-foreground">
					Confirm or correct suggested payment purposes.
				</p>
			</header>
			<Tabs
				defaultValue="review"
				onValueChange={() => {
					setRows(5);
					setOpenKey(null);
				}}
			>
				<TabsList scrollable aria-label="Pattern review status">
					{TABS.map((entry) => (
						<TabsTrigger key={entry.id} value={entry.id} className="flex-none">
							{entry.label} ({counts.get(entry.id) ?? 0})
						</TabsTrigger>
					))}
				</TabsList>
				{TABS.map((entry) => {
					const entryRows = rowViews.filter(
						(view) => view.row.tab === entry.id,
					);
					return (
						<TabsContent key={entry.id} value={entry.id}>
							{entryRows.length === 0 ? (
								<p className="m-0 text-sm text-muted-foreground">
									{entry.empty}
								</p>
							) : (
								<ul className="m-0 list-none space-y-2 p-0">
									{entryRows.slice(0, rows).map((view) => {
										const { row, title, summary } = view;
										return (
											<li key={row.key}>
												<button
													type="button"
													aria-label={`Review ${title}`}
													onClick={() => setOpenKey(row.key)}
													className={cn(
														itemVariants({ variant: "outline" }),
														"text-left",
													)}
												>
													<span className="flex flex-1 flex-col gap-1">
														<span className="line-clamp-1 text-sm leading-snug font-medium">
															{title}
														</span>
														<span className="text-sm text-muted-foreground">
															{summary.cadence} · {summary.recorded} recorded
														</span>
														{summary.amount && (
															<span
																className={
																	summary.amount.inflow
																		? "text-xs font-semibold text-success-text"
																		: "text-xs font-semibold"
																}
															>
																{summary.amount.text} ·{" "}
																{summary.amount.direction}
															</span>
														)}
														<span className="flex flex-wrap gap-1 pt-1">
															{view.chips.map((chip) => (
																<Badge key={chip.key} variant={chip.tone}>
																	{chip.label}
																</Badge>
															))}
														</span>
													</span>
													<ChevronRight
														size={16}
														aria-hidden="true"
														className="flex-none text-muted-foreground"
													/>
												</button>
											</li>
										);
									})}
								</ul>
							)}
							{entryRows.length > rows && (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => setRows((value) => value + 10)}
								>
									Show more patterns
								</Button>
							)}
						</TabsContent>
					);
				})}
			</Tabs>
			{openRow && (
				<PatternReviewDialog
					row={openRow}
					names={names}
					readOnly={readOnly}
					onClose={() => setOpenKey(null)}
				/>
			)}
		</section>
	);
}
