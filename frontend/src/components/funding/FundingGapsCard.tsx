import {
	ArrowUpRight,
	CalendarClock,
	Flag,
	Pin,
	ShieldCheck,
	TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { dateLabel, money } from "../../domain/format.ts";
import {
	deriveFundingGaps,
	orderedFundingGaps,
	summarizeFundingGap,
} from "../../domain/fundingGaps.ts";
import { fundingLabels } from "../../domain/fundingTerminology.ts";
import type { OtherEvaluationCardProps } from "../evaluationCard.ts";
import { SegmentedBar } from "../SegmentedBar.tsx";
import { Badge, IconButton } from "../ui.tsx";
import { FundingGapsModal } from "./FundingGapsModal.tsx";
import "./funding-gaps.css";

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
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const first = gaps[0];
	const summary = first ? summarizeFundingGap(first) : null;
	const clear =
		item.enabled && item.status === "satisfied" && projection !== null;
	const StateIcon = first ? TriangleAlert : clear ? ShieldCheck : Flag;
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
			<section
				className={`evaluation-card funding-gaps-card${first ? "" : clear ? " funding-gaps-empty" : " funding-gaps-unavailable"}${item.enabled ? "" : " is-excluded"}`}
			>
				<div className="funding-gaps-top">
					<h2 className="funding-gaps-title">
						<StateIcon size={16} aria-hidden="true" />
						{item.name}
					</h2>
					<div className="table-actions">
						{first && <Badge tone="amber">{gaps.length} projected</Badge>}
						{pin?.onPinChange && (
							<IconButton
								icon={Pin}
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
							<p className="section-note section-note-flush">
								First gap · {dateLabel(first.date, true)}
							</p>
							<div className="funding-gaps-hero">
								<div>
									<span className="funding-gaps-short type-value">
										{money(summary.shortfall)} short
									</span>
									<span className="funding-gaps-name">
										Missing for <strong>{first.name}</strong>
									</span>
								</div>
								<div className="funding-gaps-required">
									<span>Required</span>
									<strong className="type-value">
										{money(first.requiredAmount)}
									</strong>
								</div>
							</div>
						</div>
						<SegmentedBar
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
						{gaps.length > 1 && (
							/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled grid lists. */
							<ul className="funding-gaps-next" role="list">
								{gaps.slice(1, 3).map((gap) => (
									<li key={gap.id}>
										<span>
											<CalendarClock
												size={14}
												aria-hidden="true"
												className="inline-icon funding-gap-date-icon"
											/>
											{gap.name} <small>{dateLabel(gap.date, true)}</small>
										</span>
										<strong className="type-value">
											−{money(summarizeFundingGap(gap).shortfall)}
										</strong>
									</li>
								))}
							</ul>
						)}
						{gaps.length > 3 && (
							<span className="funding-gaps-more">
								+{gaps.length - 3} additional gaps
							</span>
						)}
						<button
							type="button"
							className="funding-gaps-cta"
							aria-label={`Inspect cash flow for ${item.name}`}
							onClick={() => setSelectedId(first.id)}
						>
							Inspect cash flow <ArrowUpRight size={15} aria-hidden="true" />
						</button>
					</>
				) : (
					<div className="funding-gaps-status">
						<h3>{statusTitle}</h3>
						{statusDescription && <p>{statusDescription}</p>}
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
