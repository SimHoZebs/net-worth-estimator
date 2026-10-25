import {
	ArrowUpRight,
	CalendarClock,
	Flag,
	Pin,
	ShieldCheck,
	TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import { dateLabel, money } from "../../domain/format.ts";
import {
	deriveFundingGaps,
	orderedFundingGaps,
	summarizeFundingGap,
} from "../../domain/fundingGaps.ts";
import { fundingLabels } from "../../domain/fundingTerminology.ts";
import type { OtherEvaluationCardProps } from "../evaluationCard.ts";
import { SegmentedBar } from "../SegmentedBar.tsx";
import { IconButton } from "../Button.tsx";
import { Badge } from "../Badge.tsx";
import { FundingGapsModal } from "./FundingGapsModal.tsx";
import { useSelectedId } from "../entrySelection.ts";
import {
	fundingCardStyles,
	fundingCardTitleStyles,
} from "./fundingCardStyles.ts";

/** The same configured funding-gap preview and inspector on both pages. */
export function FundingGapsCard({
	item,
	plan,
	projection,
	pin = null,
}: OtherEvaluationCardProps) {
	const gaps = useMemo(
		() =>
			orderedFundingGaps(
				item.enabled
					? deriveFundingGaps({ plan, projection, postingIds: item.postingIds })
					: [],
			),
		[item.enabled, item.postingIds, plan, projection],
	);
	const [selectedId, setSelectedId] = useSelectedId(plan);
	const first = gaps[0];
	const summary = first ? summarizeFundingGap(first) : null;
	const clear =
		item.enabled && item.status === "satisfied" && projection !== null;
	const StateIcon = first ? TriangleAlert : clear ? ShieldCheck : Flag;
	const state = first ? "gap" : clear ? "clear" : "unavailable";
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
			<section className={fundingCardStyles({ state })}>
				<div className="flex items-center justify-between gap-3">
					<h2 className={fundingCardTitleStyles({ state })}>
						<StateIcon size={16} aria-hidden="true" />
						{item.name}
					</h2>
					<div className="flex items-center justify-end gap-1">
						{first && <Badge tone="warning">{gaps.length} projected</Badge>}
						{pin?.onPinChange && (
							<IconButton
								icon={Pin}
								size="sm"
								iconSize={16}
								className="aria-pressed:border-success-border aria-pressed:bg-success-bg aria-pressed:text-success-text"
								label={
									pin.pinned
										? `Unpin ${item.name} from Outlook`
										: `Pin ${item.name} to Outlook`
								}
								onClick={pin.onPinChange}
								disabled={pin.disabled}
								aria-pressed={pin.pinned}
							/>
						)}
					</div>
				</div>
				{first && summary ? (
					<>
						<div>
							<p className="m-0 text-sm leading-relaxed text-muted">
								First gap · {dateLabel(first.date, true)}
							</p>
							<div className="flex items-start justify-between gap-3">
								<div>
									<span className="block text-3xl leading-tight font-medium tracking-tight text-danger-text tabular-nums">
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
						<h3 className="m-0 text-sm font-semibold">{statusTitle}</h3>
						{statusDescription && (
							<p className="mt-1 mb-0 text-xs text-muted">
								{statusDescription}
							</p>
						)}
					</div>
				)}
			</section>
			{selectedId !== null && first && (
				<FundingGapsModal
					gaps={gaps}
					selectedId={selectedId}
					onSelect={setSelectedId}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</>
	);
}
