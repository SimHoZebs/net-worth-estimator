import { useId, useMemo } from "react";
import { AccountLabel } from "../../../components/AccountIcon.tsx";
import { Checkbox, InputField } from "../../../components/Field.tsx";
import { money } from "../../../domain/format.ts";
import type { Plan } from "../../../domain/model.ts";
import type { SafeSpendingIncome } from "../../../domain/safeSpendingIncome.ts";
import type { TotalCycleSettings } from "../../../state/useSafeSpendingSettings.ts";
import { clampStatementDay } from "../../../state/useSafeSpendingSettings.ts";
import type {
	BillCandidate,
	SafeSpendingConfigHints,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { IncomeSourcesFieldset } from "./IncomeSourcesFieldset.tsx";

function AccountToggle({
	account,
	checked,
	onToggle,
}: {
	account: Pick<Plan["accounts"][number], "id" | "kind" | "color" | "name">;
	checked: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			className="group cursor-pointer rounded-control border border-line-strong bg-surface py-2 pr-3 pl-2 text-left text-xs transition-[border-color,background] duration-150 hover:bg-hover aria-pressed:border-primary aria-pressed:bg-success-bg motion-reduce:transition-none"
			aria-pressed={checked}
			onClick={onToggle}
		>
			<AccountLabel
				account={account}
				nameClassName="group-aria-[pressed=false]:text-muted"
			/>
		</button>
	);
}

export function SafeSpendingConfigurePanel({
	config,
	income,
	billCandidates,
	trackedBillIds,
	accounts,
	onToggleBill,
	onToggleAccount,
	onToggleSpendingAccount,
	onUpdateConfig,
}: {
	config: SafeSpendingConfigHints;
	income: SafeSpendingIncome;
	billCandidates: BillCandidate[];
	trackedBillIds: string[];
	accounts: Plan["accounts"];
	onToggleBill: (movementId: string) => void;
	onToggleAccount: (accountId: string) => void;
	onToggleSpendingAccount: (accountId: string) => void;
	onUpdateConfig: (next: Partial<TotalCycleSettings>) => void;
}) {
	const billsId = useId();
	const accountsById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	return (
		<div className="grid content-start gap-3">
			<p className="text-sm leading-relaxed text-muted">
				Budget settings stay in this browser. Your saved plan and bank records
				stay unchanged.
			</p>
			<InputField
				label={`${labels.cycleStart} (1–28)`}
				hint={`Sets both cycle date ranges and the closing-balance date. Also changes ${labels.scheduledBills}, days left, and ${labels.dailyAllowance}.`}
				type="number"
				min={1}
				max={28}
				value={config.statementDay}
				onChange={(event) =>
					onUpdateConfig({
						statementDay: clampStatementDay(event.target.value),
						statementDaySet: true,
					})
				}
			/>
			<InputField
				label={`${labels.reserve} ($)`}
				hint={`Reduces ${labels.allowance} in This cycle and ${labels.unallocated} in Last cycle.`}
				type="number"
				min={0}
				step="0.01"
				value={config.reserve}
				onChange={(event) =>
					onUpdateConfig({
						reserve: Math.max(0, Number(event.target.value) || 0),
					})
				}
			/>
			<IncomeSourcesFieldset
				income={income}
				onChange={(incomeRuleIds) => onUpdateConfig({ incomeRuleIds })}
			/>
			<fieldset className="grid gap-2">
				<legend className="m-0 p-0 text-xs font-semibold text-muted">
					{labels.cashAccounts}
				</legend>
				<p className="text-sm leading-relaxed text-muted">
					Feeds automatic {labels.cashBalance}, {labels.nextPaycheck},{" "}
					{labels.remainingBills}, {labels.fixedBills}, and{" "}
					{labels.cashPayments}.
				</p>
				<div className="flex flex-wrap gap-2">
					{config.spendingAccounts.map((account) => {
						const full = accountsById.get(account.id);
						const checked = config.trackedSpendingIds.includes(account.id);
						if (!full) return null;
						return (
							<AccountToggle
								key={account.id}
								account={full}
								checked={checked}
								onToggle={() => onToggleSpendingAccount(account.id)}
							/>
						);
					})}
				</div>
			</fieldset>
			<fieldset className="grid gap-2">
				<legend className="m-0 p-0 text-xs font-semibold text-muted">
					Tracked cards
				</legend>
				<p className="text-sm leading-relaxed text-muted">
					Feeds {labels.closedCards} in Last cycle and automatic{" "}
					{labels.cardSpending} in This cycle. Changes both{" "}
					{labels.recordedCharges} lists.
				</p>
				<p className="text-sm leading-relaxed text-muted">
					{labels.closedCards} uses each selected card's latest saved balance at
					or before the last cycle ends.
				</p>
				<div className="flex flex-wrap gap-2">
					{config.cards.map((card) => {
						const full = accountsById.get(card.id);
						const checked = config.trackedIds.includes(card.id);
						if (!full) return null;
						return (
							<AccountToggle
								key={card.id}
								account={full}
								checked={checked}
								onToggle={() => onToggleAccount(card.id)}
							/>
						);
					})}
				</div>
			</fieldset>
			<fieldset className="grid gap-2">
				<legend className="m-0 p-0 text-xs font-semibold text-muted">
					Included bills
				</legend>
				<p className="text-sm leading-relaxed text-muted">
					Feeds automatic {labels.remainingBills}, {labels.fixedBills}, and{" "}
					{labels.cashPayments}. Also changes {labels.scheduledBills}.
				</p>
				{billCandidates.length ? (
					billCandidates.map((bill) => {
						const checked = trackedBillIds.includes(bill.id);
						return (
							<label
								key={bill.id}
								htmlFor={`${billsId}-${bill.id}`}
								className="flex cursor-pointer items-center gap-2 text-xs text-ink"
							>
								<Checkbox
									id={`${billsId}-${bill.id}`}
									className="size-4"
									checked={checked}
									onChange={() => onToggleBill(bill.id)}
								/>
								<span>
									{bill.name} · {money(bill.amount)} · {bill.frequency}
								</span>
							</label>
						);
					})
				) : (
					<p className="text-sm leading-relaxed text-muted">
						No recurring bills found for the selected cash accounts.
					</p>
				)}
			</fieldset>
		</div>
	);
}
