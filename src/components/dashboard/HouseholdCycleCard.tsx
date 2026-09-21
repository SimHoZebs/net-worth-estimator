import { memo } from "react";
import { Link } from "react-router-dom";
import { SectionCard } from "@/components/present/present";
import { currency, formatDate } from "@/lib/format";
import type { FinancialModelDocument } from "@/lib/projection";
import { DriverCard } from "./DriverCard";
import { HOUSEHOLD_CYCLE_CUTOFF_DAY } from "./householdCycle";
import { useHouseholdCycle } from "./useHouseholdCycle";

interface HouseholdCycleCardProps {
	document: FinancialModelDocument;
}

/** Results-only household status. Inputs live in Settings. */
export const HouseholdCycleCard = memo(function HouseholdCycleCard({
	document,
}: HouseholdCycleCardProps) {
	const state = useHouseholdCycle(document);
	if (!state) return null;
	const { inputs, result, syncBalance, unclassified } = state;

	const cashDenominator = Math.max(
		Math.abs(inputs.checkingBalance),
		Math.abs(inputs.unpaidCashObligations),
		Math.abs(result.cashCushion),
		1,
	);
	const cardDenominator = Math.max(result.currentCycleCommitted, 1);

	return (
		<SectionCard
			title={`Household cycle · through the ${HOUSEHOLD_CYCLE_CUTOFF_DAY}th`}
			action={
				<Link
					to="/settings"
					className="shrink-0 rounded-full border border-border/80 px-3 py-1 type-label uppercase tracking-[0.12em] text-muted-foreground transition hover:border-ring/70 hover:text-foreground"
				>
					Edit inputs
				</Link>
			}
			className="rounded-[1.6rem] border-border shadow-sm"
		>
			<div className="mb-4 type-caption" aria-live="polite">
				{syncBalance ? (
					<>
						Synced {formatDate(syncBalance.date)}
						{syncBalance.ageDays > 0 ? ` (${syncBalance.ageDays}d old)` : ""}
						{unclassified.length > 0 ? (
							<>
								{" · "}
								{currency.format(
									unclassified.reduce((sum, row) => sum + row.amount, 0),
								)}{" "}
								unclassified ({unclassified.map((row) => row.label).join(", ")})
							</>
						) : null}
					</>
				) : (
					<>Manual inputs — no synced balances yet.</>
				)}
			</div>
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<DriverCard
					label="Cash cushion"
					value={currency.format(result.cashCushion)}
					tone={result.cashCushion < 0 ? "tertiary" : "primary"}
				/>
				<DriverCard
					label="Committed this cycle"
					value={currency.format(result.currentCycleCommitted)}
					tone="default"
				/>
				<DriverCard
					label="Room left"
					value={currency.format(result.theoreticalRoom)}
					tone={result.theoreticalRoom < 0 ? "tertiary" : "primary"}
				/>
				<DriverCard
					label="Safe to spend"
					value={currency.format(result.conservativeRoom)}
					tone={result.conservativeRoom < 0 ? "tertiary" : "primary"}
				/>
			</div>

			<div className="mt-5 grid gap-3 lg:grid-cols-2">
				<div className="rounded-2xl border border-border/70 bg-surface/70 p-4">
					<div className="type-label">Cash · checking</div>
					<div
						className="mt-2 flex h-3 overflow-hidden rounded-full bg-muted"
						aria-hidden
					>
						<div
							className="bg-primary"
							style={{
								width: `${(Math.max(inputs.checkingBalance, 0) / cashDenominator) * 100}%`,
							}}
						/>
						<div
							className="bg-tertiary"
							style={{
								width: `${(Math.max(inputs.unpaidCashObligations, 0) / cashDenominator) * 100}%`,
							}}
						/>
					</div>
					<div className="mt-2 type-caption">
						{currency.format(inputs.checkingBalance)} checking −{" "}
						{currency.format(inputs.unpaidCashObligations)} unpaid
					</div>
				</div>
				<div className="rounded-2xl border border-border/70 bg-surface/70 p-4">
					<div className="type-label">Cards · next paycheck</div>
					<div
						className="mt-2 flex h-3 overflow-hidden rounded-full bg-muted"
						aria-hidden
					>
						<div
							className="bg-primary"
							style={{
								width: `${(Math.max(inputs.primeExposure, 0) / cardDenominator) * 100}%`,
							}}
						/>
						<div
							className="bg-primary/70"
							style={{
								width: `${(Math.max(inputs.ultimateExposure, 0) / cardDenominator) * 100}%`,
							}}
						/>
						<div
							className="bg-tertiary"
							style={{
								width: `${(Math.max(inputs.wifeCurrentCycle, 0) / cardDenominator) * 100}%`,
							}}
						/>
					</div>
					<div className="mt-2 type-caption">
						{currency.format(inputs.primeExposure)} Prime +{" "}
						{currency.format(inputs.ultimateExposure)} Ultimate +{" "}
						{currency.format(inputs.wifeCurrentCycle)} wife
					</div>
				</div>
			</div>
		</SectionCard>
	);
});
