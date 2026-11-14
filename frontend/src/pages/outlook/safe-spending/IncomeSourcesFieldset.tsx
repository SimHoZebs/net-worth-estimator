import type { SafeSpendingIncome } from "../../../domain/safeSpendingIncome.ts";
import { FieldLegend, FieldSet } from "@/components/ui/field.tsx";
import { formatRuleDetail, TogglePill } from "./TogglePill.tsx";

export function IncomeSourcesFieldset({
	income,
	onChange,
}: {
	income: SafeSpendingIncome;
	onChange: (ruleIds: string[]) => void;
}) {
	return (
		<FieldSet>
			<FieldLegend variant="label">Income sources</FieldLegend>
			{income.candidates.length ? (
				<div className="flex flex-wrap gap-2">
					{income.candidates.map((rule) => {
						const checked = income.selectedScheduleIds.includes(rule.id);
						return (
							<TogglePill
								key={rule.id}
								name={rule.name}
								detail={formatRuleDetail({ amount: rule.amount })}
								checked={checked}
								onToggle={() =>
									onChange(
										checked
											? income.selectedScheduleIds.filter(
													(item) => item !== rule.id,
												)
											: [...income.selectedScheduleIds, rule.id],
									)
								}
							/>
						);
					})}
				</div>
			) : (
				<p className="text-sm leading-relaxed text-muted-foreground">
					No recurring inflows for the selected income accounts.
				</p>
			)}
		</FieldSet>
	);
}
