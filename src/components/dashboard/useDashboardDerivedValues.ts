import { useMemo } from "react";
import { currency, formatDate } from "@/lib/format";
import type { ProjectionResult, ScenarioPack } from "@/lib/projection";

export interface DashboardDerivedValues {
	firstProjectedRow: ProjectionResult["timeline"]["rows"][number] | null;
	firstShortfallRow: ProjectionResult["timeline"]["rows"][number] | null;
	biggestShortfallPosting: ProjectionResult["postingSummaries"][number] | null;
	goalReached: boolean;
	enabledPostingCount: number;
	requestedPostingAmount: number;
	realizedPostingAmount: number;
	postingUtilizationRate: number;
	statusBadgeClassName: string;
	blockerValue: string;
	blockerDetail: string;
	nextEventDetail: string;
}

export function useDashboardDerivedValues(
	result: ProjectionResult,
	pack: ScenarioPack,
): DashboardDerivedValues {
	return useMemo(() => {
		const firstProjectedRow =
			result.timeline.rows.find((row) => !row.isHistorical) ?? null;
		const firstShortfallRow =
			result.timeline.rows.find(
				(row) => !row.isHistorical && row.clampedPostingShortfallAmount > 0,
			) ?? null;
		const biggestShortfallPosting =
			result.postingSummaries
				.filter((summary) => summary.shortfallAmount > 0)
				.sort(
					(left, right) => right.shortfallAmount - left.shortfallAmount,
				)[0] ?? null;
		const goalReached =
			result.financialIndependence.milestones.firstSelfSustainingDate !== null;
		const enabledPostingCount = pack.postings.filter(
			(posting) => posting.enabled,
		).length;
		const requestedPostingAmount = result.totals.requestedPostingAmount;
		const realizedPostingAmount = result.totals.realizedPostingAmount;
		const postingUtilizationRate =
			requestedPostingAmount === 0
				? 1
				: realizedPostingAmount / requestedPostingAmount;
		const statusBadgeClassName = goalReached
			? "border-primary-border bg-primary-subtle text-primary"
			: "border-tertiary-border bg-tertiary-subtle text-tertiary-foreground";
		const blockerValue =
			biggestShortfallPosting?.label ?? "No constraint showing";
		const blockerDetail = biggestShortfallPosting
			? biggestShortfallPosting.firstShortfallDate
				? `Starting ${formatDate(biggestShortfallPosting.firstShortfallDate)}, the model cannot fully fund this scheduled payment from checking. Total unfunded amount across the projection: ${currency.format(biggestShortfallPosting.shortfallAmount)}.`
				: `The model cannot fully fund this scheduled payment. Total unfunded amount: ${currency.format(biggestShortfallPosting.shortfallAmount)}.`
			: goalReached
				? "No scheduled payment is currently limited by available funds, and the selected sources sustain the configured FI cycle."
				: "No scheduled payment is currently limited by available funds. Review selected FI sources, spending, withdrawal rate, and growth assumptions.";
		const nextEventDetail =
			firstProjectedRow === null
				? "No projected transactions are scheduled after the historical balance history."
				: `${currency.format(firstProjectedRow.requestedPostingAmount)} requested and ${currency.format(firstProjectedRow.realizedPostingAmount)} applied${firstProjectedRow.clampedPostingShortfallAmount > 0 ? `, leaving ${currency.format(firstProjectedRow.clampedPostingShortfallAmount)} unfunded.` : "."}`;

		return {
			firstProjectedRow,
			firstShortfallRow,
			biggestShortfallPosting,
			goalReached,
			enabledPostingCount,
			requestedPostingAmount,
			realizedPostingAmount,
			postingUtilizationRate,
			statusBadgeClassName,
			blockerValue,
			blockerDetail,
			nextEventDetail,
		};
	}, [result, pack]);
}
