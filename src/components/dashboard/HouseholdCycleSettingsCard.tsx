import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { FinancialModelDocument } from "@/lib/projection";
import { useHouseholdCycle } from "./useHouseholdCycle";

interface HouseholdCycleSettingsCardProps {
	document: FinancialModelDocument;
}

/** Editable household-cycle assumptions, grouped by lane. */
export const HouseholdCycleSettingsCard = memo(
	function HouseholdCycleSettingsCard({
		document,
	}: HouseholdCycleSettingsCardProps) {
		const state = useHouseholdCycle(document);
		if (!state) return null;
		const { inputs, set, reset } = state;

		return (
			<Card className="rounded-[1.4rem] border-border/80">
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<CardTitle>Household cycle</CardTitle>
							<CardDescription>
								Paycheck-cycle inputs. Results render on the Results page.
							</CardDescription>
						</div>
						<Button type="button" size="sm" variant="ghost" onClick={reset}>
							Reset to seeds
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-5">
					<fieldset className="space-y-3">
						<legend className="type-eyebrow text-muted-foreground">
							Cash lane · current checking
						</legend>
						<div className="grid gap-3 md:grid-cols-2">
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
						</div>
					</fieldset>
					<fieldset className="space-y-3">
						<legend className="type-eyebrow text-muted-foreground">
							Card lane · paid from next paycheck
						</legend>
						<div className="grid gap-3 md:grid-cols-2">
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
						</div>
					</fieldset>
					<fieldset className="space-y-3">
						<legend className="type-eyebrow text-muted-foreground">
							Paycheck lane · next cycle capacity
						</legend>
						<div className="grid gap-3 md:grid-cols-2">
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
					</fieldset>
				</CardContent>
			</Card>
		);
	},
);

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
