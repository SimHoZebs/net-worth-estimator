import {
	ArrowLeftRight,
	ArrowUpRight,
	BriefcaseBusiness,
	CalendarClock,
	GraduationCap,
	Home,
	ReceiptText,
	ShieldCheck,
	ShoppingBasket,
	TriangleAlert,
	Wrench,
	Zap,
	Wallet,
	type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { SegmentedBar } from "../SegmentedBar.tsx";
import { Badge, EmptyState } from "../ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import {
	orderedFundingGaps,
	summarizeFundingGap,
	type FundingGap,
	type FundingMovementKind,
} from "../../domain/fundingGaps.ts";
import { FundingGapsModal } from "./FundingGapsModal.tsx";
import "./funding-gaps.css";

const movementIcons: Record<FundingMovementKind, LucideIcon> = {
	income: BriefcaseBusiness,
	housing: Home,
	utilities: Zap,
	groceries: ShoppingBasket,
	insurance: ShieldCheck,
	repair: Wrench,
	transfer: ArrowLeftRight,
	tax: ReceiptText,
	education: GraduationCap,
	other: Wallet,
};

export function FundingMovementIcon({
	kind,
	size = 16,
}: {
	kind: FundingMovementKind;
	size?: number;
}) {
	const Icon = movementIcons[kind];
	return <Icon size={size} aria-hidden="true" />;
}

/** Preview card for all projected funding gaps. Click opens the inspector. */
export function FundingGapsCard({
	gaps,
	pending = false,
}: {
	gaps: FundingGap[];
	pending?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const sorted = orderedFundingGaps(gaps).filter(
		(gap) => summarizeFundingGap(gap).shortfall > 0.5,
	);
	if (pending) return null;
	if (!sorted.length) {
		return (
			<div className="funding-gaps-empty">
				<EmptyState
					icon={ShieldCheck}
					title="No projected funding gaps"
					description="All scheduled payments can be covered in the evaluated period."
				/>
			</div>
		);
	}
	const first = sorted[0]!;
	const summary = summarizeFundingGap(first);
	const openGap = (id: string) => {
		setSelectedId(id);
		setOpen(true);
	};
	return (
		<>
			<button
				type="button"
				className="funding-gaps-card"
				onClick={() => openGap(first.id)}
				aria-label={`${sorted.length} projected funding failures. First: ${first.name} on ${dateLabel(first.date, true)}, short ${money(summary.shortfall)}. Inspect cash flow.`}
			>
				<span className="funding-gaps-top">
					<span className="funding-gaps-title">
						<TriangleAlert size={16} aria-hidden="true" />
						Funding gaps
					</span>
					<Badge tone="amber">{sorted.length} projected</Badge>
				</span>
				<span>
					<span className="section-note" style={{ padding: 0 }}>
						First failure · {dateLabel(first.date, true)}
					</span>
					<span className="funding-gaps-hero">
						<span>
							<span className="funding-gaps-short type-value">
								{money(summary.shortfall)} short
							</span>
							<span className="funding-gaps-name">
								Missing for <strong>{first.name}</strong>
							</span>
						</span>
						<span className="funding-gaps-required">
							<span>Required</span>
							<strong>{money(first.requiredAmount)}</strong>
						</span>
					</span>
				</span>
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
				{sorted.length > 1 && (
					<ul className="funding-gaps-next">
						{sorted.slice(1, 3).map((gap) => {
							const details = summarizeFundingGap(gap);
							return (
								<li key={gap.id}>
									<span>
										<CalendarClock
											size={14}
											aria-hidden="true"
											style={{ marginRight: 8, verticalAlign: -2 }}
										/>
										{gap.name} <small>{dateLabel(gap.date, true)}</small>
									</span>
									<strong>−{money(details.shortfall)}</strong>
								</li>
							);
						})}
					</ul>
				)}
				{sorted.length > 3 && (
					<span className="funding-gaps-more">
						+{sorted.length - 3} additional failures
					</span>
				)}
				<span className="funding-gaps-cta">
					Inspect cash flow <ArrowUpRight size={15} aria-hidden="true" />
				</span>
			</button>
			{open && (
				<FundingGapsModal
					gaps={sorted}
					selectedId={selectedId ?? first.id}
					onSelect={setSelectedId}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}
