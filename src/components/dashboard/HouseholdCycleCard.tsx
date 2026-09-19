import { memo } from "react";
import { Link } from "react-router-dom";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
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
		<Card className="rounded-[1.6rem] border-border shadow-sm">
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle>Household cycle</CardTitle>
						<CardDescription>
							Paycheck-cycle status through the {HOUSEHOLD_CYCLE_CUTOFF_DAY}th.
							Cash cushion and card-cycle capacity stay completely separate:
							current-cycle card charges are paid from the next paycheck, not
							current checking.
						</CardDescription>
					</div>
					<Link
						to="/settings"
						className="shrink-0 rounded-full border border-border/80 px-3 py-1 type-label uppercase tracking-[0.12em] text-muted-foreground transition hover:border-ring/70 hover:text-foreground"
					>
						Edit inputs
					</Link>
				</div>
			</CardHeader>
			<CardContent>
				<div className="mb-4 type-caption" aria-live="polite">
					{syncBalance ? (
						<>
							Synced balances as of {formatDate(syncBalance.date)} (
							{syncBalance.ageDays === 0
								? "today"
								: `${syncBalance.ageDays}d old`}
							) across {syncBalance.syncedAccounts}{" "}
							{syncBalance.syncedAccounts === 1 ? "account" : "accounts"}. Card
							inputs are seeded from pending sync rows; adjust them in Settings.
						</>
					) : (
						<>
							No synced balances yet — inputs are manual. Configure the
							SimpleFIN sync to seed balances and pending card charges, then
							adjust them in Settings.
						</>
					)}
					{unclassified.length > 0 ? (
						<>
							{" "}
							{currency.format(
								unclassified.reduce((sum, row) => sum + row.amount, 0),
							)}{" "}
							in pending rows did not match a card slot (
							{unclassified.map((row) => row.label).join(", ")}).
						</>
					) : null}
				</div>
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<DriverCard
						label="Cash cushion"
						value={currency.format(result.cashCushion)}
						detail="Checking − unpaid cash obligations before next paycheck"
						tone={result.cashCushion < 0 ? "tertiary" : "primary"}
					/>
					<DriverCard
						label={`Current cycle committed through the ${HOUSEHOLD_CYCLE_CUTOFF_DAY}th`}
						value={currency.format(result.currentCycleCommitted)}
						detail="Prime + Ultimate exposure including pending + wife's current-cycle amount"
						tone="default"
					/>
					<DriverCard
						label="Theoretical room left"
						value={currency.format(result.theoreticalRoom)}
						detail="Paycheck − next month's fixed obligations − committed"
						tone={result.theoreticalRoom < 0 ? "tertiary" : "primary"}
					/>
					<DriverCard
						label="Conservative room left"
						value={currency.format(result.conservativeRoom)}
						detail="Theoretical room − protected reserve"
						tone={result.conservativeRoom < 0 ? "tertiary" : "primary"}
					/>
				</div>

				<div className="mt-5 grid gap-3 lg:grid-cols-2">
					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4">
						<div className="type-label">Cash lane · current checking</div>
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
							{currency.format(inputs.unpaidCashObligations)} unpaid ={" "}
							{currency.format(result.cashCushion)} cushion
						</div>
					</div>
					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4">
						<div className="type-label">
							Card lane · paid from next paycheck
						</div>
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
							{currency.format(inputs.wifeCurrentCycle)} wife ={" "}
							{currency.format(result.currentCycleCommitted)} committed
						</div>
					</div>
				</div>

				<div className="mt-5 overflow-x-auto">
					<Table>
						<TableBody>
							<TableRow>
								<TableCell className="type-body text-foreground/80">
									Cash cushion
								</TableCell>
								<TableCell className="text-right type-value text-sm">
									{currency.format(result.cashCushion)}
								</TableCell>
							</TableRow>
							<TableRow>
								<TableCell className="type-body text-foreground/80">
									Current cycle committed through the{" "}
									{HOUSEHOLD_CYCLE_CUTOFF_DAY}th
								</TableCell>
								<TableCell className="text-right type-value text-sm">
									{currency.format(result.currentCycleCommitted)}
								</TableCell>
							</TableRow>
							<TableRow>
								<TableCell className="type-body text-foreground/80">
									Theoretical room left
								</TableCell>
								<TableCell className="text-right type-value text-sm">
									{currency.format(result.theoreticalRoom)}
								</TableCell>
							</TableRow>
							<TableRow>
								<TableCell className="type-body text-foreground/80">
									Conservative room left
								</TableCell>
								<TableCell className="text-right type-value text-sm">
									{currency.format(result.conservativeRoom)}
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
				</div>

				<p className="mt-4 type-body text-foreground/85">
					So the clean numbers are: {currency.format(result.cashCushion)} cash
					cushion now, {currency.format(result.currentCycleCommitted)} committed
					to the current cycle, {currency.format(result.conservativeRoom)} safe
					room / {currency.format(result.theoreticalRoom)} absolute theoretical
					room until the {HOUSEHOLD_CYCLE_CUTOFF_DAY}th.
				</p>
			</CardContent>
		</Card>
	);
});
