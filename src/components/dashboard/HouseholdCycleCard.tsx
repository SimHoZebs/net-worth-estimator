import { memo, useMemo, useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { currency, formatDate } from "@/lib/format";
import type { FinancialModelDocument } from "@/lib/projection";
import { DriverCard } from "./DriverCard";
import {
	computeHouseholdCycle,
	DEFAULT_HOUSEHOLD_CYCLE_INPUTS,
	HOUSEHOLD_CYCLE_CUTOFF_DAY,
	type HouseholdCycleInputs,
	latestCheckingBalance,
	latestSyncBalance,
	seedExposureFromSync,
} from "./householdCycle";

interface HouseholdCycleCardProps {
	document: FinancialModelDocument;
}

function parseAmount(raw: string): number {
	const value = Number(raw);
	return Number.isFinite(value) ? value : 0;
}

export const HouseholdCycleCard = memo(function HouseholdCycleCard({
	document,
}: HouseholdCycleCardProps) {
	const seededChecking = useMemo(
		() =>
			latestCheckingBalance(document) ??
			DEFAULT_HOUSEHOLD_CYCLE_INPUTS.checkingBalance,
		[document],
	);
	const [inputs, setInputs] = useState<HouseholdCycleInputs>(() => ({
		...DEFAULT_HOUSEHOLD_CYCLE_INPUTS,
		checkingBalance: seededChecking,
	}));
	const [touched, setTouched] = useState<
		ReadonlySet<keyof HouseholdCycleInputs>
	>(new Set());
	const syncSeed = useMemo(() => seedExposureFromSync(document), [document]);
	const syncBalance = useMemo(() => latestSyncBalance(document), [document]);
	// Adjust untouched inputs while rendering so children never see a stale
	// seed value. React discards this pass and re-renders immediately.
	const checkingSeed = latestCheckingBalance(document);
	const seedCandidates = {
		checkingBalance: checkingSeed,
		primeExposure: syncSeed.prime,
		ultimateExposure: syncSeed.ultimate,
		wifeCurrentCycle: syncSeed.wife,
	} as const;
	let syncedInputs: HouseholdCycleInputs | null = null;
	for (const [key, value] of Object.entries(seedCandidates)) {
		const field = key as keyof typeof seedCandidates;
		if (value === null || touched.has(field)) continue;
		const current = inputs[field];
		if (current !== value) {
			syncedInputs = { ...(syncedInputs ?? inputs), [field]: value };
		}
	}
	if (syncedInputs !== null) setInputs(syncedInputs);
	const result = useMemo(() => computeHouseholdCycle(inputs), [inputs]);

	const set = (key: keyof HouseholdCycleInputs) => (raw: string) => {
		setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
		setInputs((prev) => ({ ...prev, [key]: parseAmount(raw) }));
	};

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
				<div>
					<CardTitle>Household cycle</CardTitle>
					<CardDescription>
						Paycheck-cycle status through the {HOUSEHOLD_CYCLE_CUTOFF_DAY}th.
						Cash cushion and card-cycle capacity stay completely separate:
						current-cycle card charges are paid from the next paycheck, not
						current checking.
					</CardDescription>
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
							inputs below were seeded from pending sync rows and stay editable.
						</>
					) : (
						<>
							No synced balances yet — all inputs are manual. Configure the
							SimpleFIN sync to seed balances and pending card charges.
						</>
					)}
					{syncSeed.unclassified.length > 0 ? (
						<>
							{" "}
							{currency.format(
								syncSeed.unclassified.reduce((sum, row) => sum + row.amount, 0),
							)}{" "}
							in pending rows did not match a card slot (
							{syncSeed.unclassified.map((row) => row.label).join(", ")}).
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

				<div className="mt-5 grid gap-3 md:grid-cols-2">
					<AmountField
						label="Checking balance"
						value={inputs.checkingBalance}
						onChange={set("checkingBalance")}
					/>
					<AmountField
						label="Unpaid cash obligations before next paycheck"
						value={inputs.unpaidCashObligations}
						onChange={set("unpaidCashObligations")}
					/>
					<AmountField
						label="Prime current-cycle exposure (incl. pending)"
						value={inputs.primeExposure}
						onChange={set("primeExposure")}
					/>
					<AmountField
						label="Ultimate current-cycle exposure (incl. pending)"
						value={inputs.ultimateExposure}
						onChange={set("ultimateExposure")}
					/>
					<AmountField
						label="Wife's current-cycle amount"
						value={inputs.wifeCurrentCycle}
						onChange={set("wifeCurrentCycle")}
					/>
					<AmountField
						label="Expected next paycheck"
						value={inputs.expectedPaycheck}
						onChange={set("expectedPaycheck")}
					/>
					<AmountField
						label="Next month's fixed obligations"
						value={inputs.nextMonthFixedObligations}
						onChange={set("nextMonthFixedObligations")}
					/>
					<AmountField
						label="Protected reserve"
						value={inputs.protectedReserve}
						onChange={set("protectedReserve")}
					/>
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

function AmountField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (raw: string) => void;
}) {
	return (
		<label className="block rounded-2xl border border-border/70 bg-card/80 px-3 py-2">
			<span className="type-label">{label}</span>
			<Input
				type="number"
				aria-label={label}
				className="mt-1 tabular-nums"
				value={String(value)}
				onChange={(event) => onChange(event.target.value)}
			/>
		</label>
	);
}
