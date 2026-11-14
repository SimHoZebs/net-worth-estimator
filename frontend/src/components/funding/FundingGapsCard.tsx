import {
	ArrowUpRight,
	CalendarClock,
	Flag,
	Pin,
	ShieldCheck,
	TriangleAlert,
} from "lucide-react";
import { lazy, Suspense, useId, useMemo } from "react";
import { dateLabel, money } from "@/domain/format.ts";
import {
	deriveFundingGaps,
	orderedFundingGaps,
	summarizeFundingGap,
} from "@/domain/fundingGaps.ts";
import { fundingLabels } from "@/domain/fundingTerminology.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import type {
	EvaluationPin,
	OtherEvaluationCardProps,
} from "@/components/evaluationCard.ts";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "@/state/savedState.ts";
import { SegmentedBar } from "@/components/SegmentedBar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import { cn } from "@/lib/utils.ts";
import { useSelectedId } from "@/components/entrySelection.ts";

const FundingGapsModal = lazy(() =>
	import("@/components/funding/FundingGapsModal.tsx").then((module) => ({
		default: module.FundingGapsModal,
	})),
);

/** The same configured funding-gap preview and inspector on both pages. */
export function FundingGapsCard({
	item,
	projection,
	pin = null,
}: {
	item: OtherEvaluation;
	projection: OtherEvaluationCardProps["projection"];
	pin?: EvaluationPin | null;
}) {
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const gaps = useMemo(
		() =>
			!accounts || !transactions || !startDate
				? []
				: orderedFundingGaps(
						item.enabled
							? deriveFundingGaps({
									accounts,
									transactions,
									startDate,
									projection,
									transactionIds: item.transactionIds,
								})
							: [],
					),
		[
			item.enabled,
			item.transactionIds,
			accounts,
			transactions,
			startDate,
			projection,
		],
	);
	const [selectedId, setSelectedId] = useSelectedId();
	// The inspector follows its gap: a selected id with no current gap
	// renders as no selection and closes, instead of falling back to a
	// different gap.
	const selected =
		selectedId !== null && gaps.some((gap) => gap.id === selectedId)
			? selectedId
			: null;
	const headingId = useId();
	const first = gaps[0];
	const summary = first ? summarizeFundingGap(first) : null;
	const clear =
		item.enabled && item.status === "satisfied" && projection !== null;
	const StateIcon = first ? TriangleAlert : clear ? ShieldCheck : Flag;
	const state = first ? "gap" : clear ? "clear" : "unavailable";
	const tone =
		state === "gap" ? "warning" : state === "clear" ? "success" : "default";
	const stateTitle =
		state === "gap"
			? "text-warning-text"
			: state === "clear"
				? "text-success-text"
				: "text-muted";
	const statusTitle = !item.enabled
		? "Paused"
		: !projection
			? "Calculating…"
			: clear
				? fundingLabels.clear
				: item.outcomeText;
	const statusDescription = !item.enabled
		? "Excluded from evaluation"
		: (item.qualifier ??
			(clear
				? "All selected payments can be covered in the evaluated period."
				: null));
	return (
		<>
			<Card
				role="region"
				aria-labelledby={headingId}
				className={cn(
					"h-full w-full min-w-0 max-w-2xl flex-col gap-4 rounded-surface border p-5 text-base text-ink ring-0 print:break-inside-avoid",
					tone === "success"
						? "border-success-border bg-success-bg"
						: tone === "warning"
							? "border-warning-border bg-warning-bg"
							: "border-line bg-surface",
					"relative overflow-visible text-left text-inherit has-[>button:hover]:border-warning-text has-[>button:hover]:shadow-sm",
				)}
			>
				<CardHeader className="px-0 pt-0">
					<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
						<CardTitle
							id={headingId}
							className={cn(
								"m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]",
								stateTitle,
							)}
						>
							<StateIcon size={16} aria-hidden="true" className="shrink-0" />
							<span className="[overflow-wrap:anywhere]">{item.name}</span>
						</CardTitle>
						<div className="flex items-center justify-end gap-1">
							{first && (
								<Badge
									variant="default"
									className="h-auto bg-warning-bg text-warning-text"
								>
									{gaps.length} projected
								</Badge>
							)}
							{pin?.onPinChange && (
								<Button
									variant="ghost"
									size="icon-sm"
									title={
										pin.pinned
											? `Unpin ${item.name} from Outlook`
											: `Pin ${item.name} to Outlook`
									}
									aria-label={
										pin.pinned
											? `Unpin ${item.name} from Outlook`
											: `Pin ${item.name} to Outlook`
									}
									onClick={pin.onPinChange}
									disabled={pin.disabled}
									aria-pressed={pin.pinned}
									className="text-muted enabled:hover:bg-hover enabled:hover:text-ink aria-pressed:border-success-border aria-pressed:bg-success-bg aria-pressed:text-success-text focus-visible:outline-solid focus-visible:ring-0"
								>
									<Pin size={16} aria-hidden="true" />
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent className="flex flex-col gap-4 px-0 pb-0">
					{first && summary ? (
						<>
							<div>
								<p className="m-0 text-sm leading-relaxed text-muted">
									First gap · {dateLabel(first.date, true)}
								</p>
								<div className="flex items-start justify-between gap-3">
									<div>
										<span className="type-value-display block text-danger-text">
											{money(summary.shortfall)} short
										</span>
										<span className="mt-2 block text-xs leading-relaxed text-muted">
											Missing for{" "}
											<strong className="text-ink">{first.name}</strong>
										</span>
									</div>
									<div className="flex-none text-right">
										<span className="text-xs text-muted">Required</span>
										<strong className="mt-1 block text-base tabular-nums">
											{money(first.requiredAmount)}
										</strong>
									</div>
								</div>
							</div>
							<SegmentedBar
								className="mt-0.5"
								captionClassName="text-xs text-muted"
								caption={`Available ${money(summary.coveredAmount)} of ${money(first.requiredAmount)} required`}
								ariaLabel={`${Math.round(summary.coveragePercent)} percent covered; ${money(summary.shortfall)} short`}
								segments={[
									{
										label: "Available",
										amount: summary.coveredAmount,
										pattern: "solid",
										tone: "sage",
									},
									{
										label: "Missing",
										amount: summary.shortfall,
										pattern: "hatch",
										tone: "tan",
									},
								]}
							/>
							{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled grid lists. */}
							{gaps.length > 1 && (
								<ul
									className="m-0 grid list-none gap-3 border-t border-warning-border px-0 pt-3 pb-0"
									role="list"
								>
									{gaps.slice(1, 3).map((gap) => (
										<li
											key={gap.id}
											className="flex items-center justify-between gap-3 text-xs"
										>
											<span>
												<CalendarClock
													size={14}
													aria-hidden="true"
													className="mr-2 inline align-middle"
												/>
												{gap.name}{" "}
												<small className="text-xs text-muted">
													{dateLabel(gap.date, true)}
												</small>
											</span>
											<strong className="text-danger-text tabular-nums">
												−{money(summarizeFundingGap(gap).shortfall)}
											</strong>
										</li>
									))}
								</ul>
							)}
							{/* oxlint-enable jsx-a11y/no-redundant-roles */}
							{gaps.length > 3 && (
								<span className="text-xs text-muted">
									+{gaps.length - 3} additional gaps
								</span>
							)}
							<button
								type="button"
								className="mt-auto flex items-center justify-between rounded-control border border-warning-border bg-surface px-3 py-3 text-xs font-semibold text-warning-text"
								aria-label={`Inspect cash flow for ${item.name}`}
								onClick={() => setSelectedId(first.id)}
							>
								Inspect cash flow <ArrowUpRight size={15} aria-hidden="true" />
							</button>
						</>
					) : (
						<div>
							<div className="type-value-display mt-0 mr-0 mb-1 ml-0">
								{statusTitle}
							</div>
							{statusDescription && (
								<p className="m-0 text-sm leading-relaxed text-muted">
									{statusDescription}
								</p>
							)}
						</div>
					)}
				</CardContent>
			</Card>
			{selected !== null && (
				<Suspense fallback={null}>
					<FundingGapsModal
						gaps={gaps}
						selectedId={selected}
						onSelect={setSelectedId}
						onClose={() => setSelectedId(null)}
					/>
				</Suspense>
			)}
		</>
	);
}
