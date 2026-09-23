import { memo } from "react";
import { LabeledField } from "@/components/fields/field-kit";
import { SectionCard } from "@/components/present/present";
import { Button } from "@/components/ui/button";
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
			<SectionCard
				title="Household"
				action={
					<Button type="button" size="sm" variant="ghost" onClick={reset}>
						Reset
					</Button>
				}
				className="rounded-[1.4rem] border-border/80"
				contentClassName="space-y-5"
			>
				<fieldset className="space-y-3">
					<legend className="type-eyebrow text-muted-foreground">Cash</legend>
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
					<legend className="type-eyebrow text-muted-foreground">Cards</legend>
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
						Paycheck
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
			</SectionCard>
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
		<LabeledField
			label={label}
			type="number"
			inputMode="decimal"
			value={String(value)}
			onChange={onChange}
			className="min-h-11 tabular-nums"
		/>
	);
}
