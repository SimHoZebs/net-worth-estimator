import { useId } from "react";
import { Checkbox } from "../../../components/Field.tsx";
import { dateLabel, exactMoney } from "../../../domain/format.ts";
import type { SafeSpendingIncome } from "../../../domain/safeSpendingIncome.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export function IncomeSourcesFieldset({
	income,
	onChange,
}: {
	income: SafeSpendingIncome;
	onChange: (ruleIds: string[]) => void;
}) {
	const id = useId();
	return (
		<fieldset className="grid gap-2" aria-describedby={`${id}-hint`}>
			<legend className="m-0 p-0 text-xs font-semibold text-muted">
				Income sources
			</legend>
			<p id={`${id}-hint`} className="text-sm leading-relaxed text-muted">
				Select active recurrence rules that pay into your selected cash
				accounts. Automatic {labels.nextPaycheck} adds the next projected
				payment from each selected rule, even on different dates. No selection
				means $0.
			</p>
			{income.candidates.length ? (
				income.candidates.map((rule) => {
					const checked = income.selectedRuleIds.includes(rule.id);
					return (
						<label
							key={rule.id}
							htmlFor={`${id}-${rule.id}`}
							className="flex min-h-12 cursor-pointer items-center gap-2 text-sm text-ink"
						>
							<Checkbox
								id={`${id}-${rule.id}`}
								name="incomeRuleIds"
								value={rule.id}
								className="size-4 shrink-0"
								checked={checked}
								onChange={() =>
									onChange(
										checked
											? income.selectedRuleIds.filter(
													(item) => item !== rule.id,
												)
											: [...income.selectedRuleIds, rule.id],
									)
								}
							/>
							<span>
								{rule.name}
								<small className="block text-xs text-muted">
									{rule.frequency} ·{" "}
									{rule.nextPayment
										? `${exactMoney(rule.nextPayment.amount)} on ${dateLabel(rule.nextPayment.date, true)}`
										: "No upcoming payment in the projection"}
								</small>
							</span>
						</label>
					);
				})
			) : (
				<p className="text-sm leading-relaxed text-muted">
					No active income recurrence rules found for the selected cash
					accounts.
				</p>
			)}
		</fieldset>
	);
}
