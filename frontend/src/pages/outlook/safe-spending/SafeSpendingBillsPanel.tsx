import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { exactMoney, monthDay } from "../../../domain/format.ts";
import type {
	CycleAllocation,
	SafeSpendingHeroes,
	SafeSpendingMandatorySection,
} from "./safeSpendingDetailModel.ts";
import { describeAllowance } from "./allowanceView.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
const SafeSpendingTrendChart = lazy(() =>
	import("./SafeSpendingTrendChart.tsx").then((module) => ({
		default: module.SafeSpendingTrendChart,
	})),
);
import { cn } from "@/lib/utils.ts";
import type { SafeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";

/**
 * One compact decision row: plain label on the left, base-size value on
 * the right, with an optional qualifier underneath.
 */
function StatRow({
	label,
	value,
	tone = "normal",
	testId,
	qualifier,
}: {
	label: string;
	value: string;
	tone?: "normal" | "positive" | "negative";
	testId: string;
	qualifier?: string;
}) {
	return (
		<div className="grid min-w-0 gap-1">
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm text-muted-foreground">{label}</span>
				<strong
					data-testid={testId}
					className={cn(
						"m-0 text-base font-bold whitespace-nowrap tabular-nums [overflow-wrap:anywhere]",
						tone === "positive"
							? "text-success-text"
							: tone === "negative"
								? "text-danger-text"
								: "text-foreground",
					)}
				>
					{value}
				</strong>
			</div>
			{qualifier && (
				<p className="m-0 text-xs text-muted-foreground">{qualifier}</p>
			)}
		</div>
	);
}

export function SafeSpendingBillsPanel({
	heroes,
	cashEvidence,
	allocation,
	trend,
	section,
	closed = false,
}: {
	heroes: SafeSpendingHeroes;
	cashEvidence: React.ReactNode;
	allocation: CycleAllocation;
	trend?: SafeSpendingTrend;
	section: SafeSpendingMandatorySection;
	/** The statement already closed; the payday and pace are historical. */
	closed?: boolean;
}) {
	const amountText = (value: number | null) =>
		value === null ? "—" : exactMoney(value);
	const allowanceView = describeAllowance({
		allowance: allocation.allowance,
		theoretical: heroes.theoretical,
		reserve: allocation.reserve,
		available: allocation.available,
	});
	const spendLabel = `Spend by ${monthDay(heroes.cycleEnd)}`;
	const spendQualifier =
		allowanceView.phase === "unavailable"
			? undefined
			: allowanceView.phase === "safe"
				? undefined
				: allowanceView.phase === "into-reserve"
					? `${exactMoney(allowanceView.intoReserve)} of ${exactMoney(allocation.reserve)} reserve in use`
					: closed
						? `Over budget by ${exactMoney(allowanceView.overLimit)}`
						: `Over limit by ${exactMoney(allowanceView.overLimit)}`;
	const dailyValue =
		allowanceView.phase === "unavailable"
			? null
			: allowanceView.phase === "safe"
				? Math.max(0, heroes.dailySafe)
				: Math.max(0, heroes.dailyTheoretical);
	return (
		<div className="grid content-start gap-4">
			{trend && (
				<div className="grid content-start gap-4">
					<Suspense
						fallback={
							<div aria-busy="true">
								<Skeleton className="h-40 w-full" />
							</div>
						}
					>
						<SafeSpendingTrendChart trend={trend} historical={closed} />
					</Suspense>
				</div>
			)}
			{cashEvidence}
			<div className="grid content-start gap-4">
				{closed ? (
					<>
						<StatRow
							label={labels.recordedCharges}
							value={
								heroes.committedTotal === null
									? "—"
									: exactMoney(heroes.committedTotal)
							}
							testId="recorded-charges-value"
						/>
						{heroes.closedCycle.total !== null && (
							<StatRow
								label="Closed card balance"
								value={amountText(heroes.closedCycle.total)}
								testId="closed-card-value"
							/>
						)}
					</>
				) : (
					<>
						<div className="grid grid-cols-1 gap-3 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
							<StatRow
								label={spendLabel}
								value={amountText(allowanceView.primary)}
								tone={allowanceView.tone}
								testId="spend-value"
								qualifier={spendQualifier}
							/>
							<StatRow
								label={labels.perDay}
								value={dailyValue === null ? "—" : exactMoney(dailyValue)}
								testId="perday-value"
							/>
						</div>
						{!allocation.available && (
							<p className="m-0 text-xs text-muted-foreground">
								Current cash evidence unavailable
							</p>
						)}
					</>
				)}
			</div>
			{closed && (
				<StatRow
					label="Cash payments"
					value={exactMoney(section.total)}
					testId="cash-payments-value"
				/>
			)}
		</div>
	);
}
