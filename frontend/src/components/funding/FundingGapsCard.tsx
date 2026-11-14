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
	CardAction,
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
				: "text-muted-foreground";
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
					"h-full w-full min-w-0 max-w-2xl print:break-inside-avoid",
					tone === "success"
						? "ring-success-border bg-success-bg"
						: tone === "warning"
							? "ring-warning-border bg-warning-bg"
							: undefined,
				)}
			>
				<CardHeader>
					<CardTitle
						id={headingId}
						className={cn(
							"flex items-center gap-2 [overflow-wrap:anywhere]",
							stateTitle,
						)}
					>
						<StateIcon size={16} aria-hidden="true" className="shrink-0" />
						<span className="[overflow-wrap:anywhere]">{item.name}</span>
					</CardTitle>
					<CardAction className="flex items-center gap-1">
						{first && (
							<Badge
								variant="default"
								className="bg-warning-bg text-warning-text"
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
								className="aria-pressed:border-success-border aria-pressed:bg-success-bg aria-pressed:text-success-text"
							>
								<Pin size={16} aria-hidden="true" />
							</Button>
						)}
					</CardAction>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{first && summary ? (
						<>
							<div>
								<p className="m-0 text-sm leading-relaxed text-muted-foreground">
									First gap · {dateLabel(first.date, true)}
								</p>
								<div className="flex items-start justify-between gap-3">
									<div>
										<span className="type-value-display block text-danger-text">
											{money(summary.shortfall)} short
										</span>
										<span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
											Missing for{" "}
											<strong className="text-foreground">{first.name}</strong>
										</span>
									</div>
									<div className="flex-none text-right">
										<span className="text-xs text-muted-foreground">
											Required
										</span>
										<strong className="mt-1 block text-base tabular-nums">
											{money(first.requiredAmount)}
										</strong>
									</div>
								</div>
							</div>
							<SegmentedBar
								className="mt-0.5"
								captionClassName="text-xs text-muted-foreground"
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
												<small className="text-xs text-muted-foreground">
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
								<span className="text-xs text-muted-foreground">
									+{gaps.length - 3} additional gaps
								</span>
							)}
							<Button
								type="button"
								variant="outline"
								className="mt-auto w-full justify-between border-warning-border text-warning-text"
								aria-label={`Inspect cash flow for ${item.name}`}
								onClick={() => setSelectedId(first.id)}
							>
								Inspect cash flow <ArrowUpRight size={15} aria-hidden="true" />
							</Button>
						</>
					) : (
						<div>
							<div className="type-value-display mt-0 mr-0 mb-1 ml-0">
								{statusTitle}
							</div>
							{statusDescription && (
								<p className="m-0 text-sm leading-relaxed text-muted-foreground">
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
