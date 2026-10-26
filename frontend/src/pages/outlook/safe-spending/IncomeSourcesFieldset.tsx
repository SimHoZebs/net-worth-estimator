import type { SafeSpendingIncome } from "../../../domain/safeSpendingIncome.ts";
import { formatRuleDetail, RuleTogglePill } from "./RuleTogglePill.tsx";

export function IncomeSourcesFieldset({
	income,
	onChange,
}: {
	income: SafeSpendingIncome;
	onChange: (ruleIds: string[]) => void;
}) {
	return (
		<fieldset className="grid gap-3">
			<legend className="m-0 mb-1 p-0 text-xs font-semibold text-muted">
				Income sources
			</legend>
			{income.candidates.length ? (
				<div className="flex flex-wrap gap-2">
					{income.candidates.map((rule) => {
						const checked = income.selectedRuleIds.includes(rule.id);
						return (
							<RuleTogglePill
								key={rule.id}
								name={rule.name}
								detail={formatRuleDetail({
									frequency: rule.frequency,
									amount: rule.amount,
								})}
								checked={checked}
								onToggle={() =>
									onChange(
										checked
											? income.selectedRuleIds.filter(
													(item) => item !== rule.id,
												)
											: [...income.selectedRuleIds, rule.id],
									)
								}
							/>
						);
					})}
				</div>
			) : (
				<p className="text-sm leading-relaxed text-muted">
					No recurring inflows for the selected income accounts.
				</p>
			)}
		</fieldset>
	);
}
