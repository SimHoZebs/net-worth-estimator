import { useId, useMemo } from "react";
import { AccountToggle } from "../../../components/AccountToggle.tsx";
import { Field, FieldLegend, FieldSet } from "@/components/ui/field.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { TotalCycleSettings } from "../../../state/useSafeSpendingSettings.ts";
import { clampStatementDay } from "../../../state/useSafeSpendingSettings.ts";
import type {
	BillCandidate,
	SafeSpendingConfigHints,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { formatRuleDetail, TogglePill } from "./TogglePill.tsx";

export function SafeSpendingConfigurePanel({
	config,
	billCandidates,
	trackedBillIds,
	accounts,
	incomeAccounts,
	incomeAccountIds,
	incomeCandidates,
	incomeScheduleIds,
	onToggleIncomeAccount,
	onToggleIncomeSource,
	onToggleBill,
	onToggleAccount,
	onToggleSpendingAccount,
	onUpdateConfig,
}: {
	config: SafeSpendingConfigHints;
	billCandidates: BillCandidate[];
	trackedBillIds: string[];
	accounts: Account[];
	incomeAccounts: Account[];
	incomeAccountIds: string[];
	incomeCandidates: Transaction[];
	incomeScheduleIds: string[];
	onToggleIncomeAccount: (id: string) => void;
	onToggleIncomeSource: (id: string) => void;
	onToggleBill: (transactionId: string) => void;
	onToggleAccount: (accountId: string) => void;
	onToggleSpendingAccount: (accountId: string) => void;
	onUpdateConfig: (next: Partial<TotalCycleSettings>) => void;
}) {
	const accountsById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	const cycleStartId = useId();
	const reserveId = useId();
	return (
		<div className="grid content-start gap-3">
			<Field>
				<Label htmlFor={cycleStartId}>{`${labels.cycleStart} (1–28)`}</Label>
				<Input
					id={cycleStartId}
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
			</Field>
			<Field>
				<Label htmlFor={reserveId}>{`${labels.reserve} ($)`}</Label>
				<Input
					id={reserveId}
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
			</Field>
			<FieldSet>
				<FieldLegend variant="label">{labels.cashAccounts}</FieldLegend>
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
			</FieldSet>
			<FieldSet>
				<FieldLegend variant="label">Tracked cards</FieldLegend>
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
			</FieldSet>
			<FieldSet>
				<FieldLegend variant="label">Income accounts</FieldLegend>
				<div className="flex flex-wrap gap-2">
					{incomeAccounts.map((account) => (
						<AccountToggle
							key={account.id}
							account={account}
							checked={incomeAccountIds.includes(account.id)}
							onToggle={() => onToggleIncomeAccount(account.id)}
						/>
					))}
					{incomeAccountIds
						.filter(
							(id) => !incomeAccounts.some((account) => account.id === id),
						)
						.map((id) => (
							<TogglePill
								key={id}
								name={`Unavailable account (${id})`}
								detail="Remove selection"
								checked
								onToggle={() => onToggleIncomeAccount(id)}
							/>
						))}
				</div>
			</FieldSet>
			<FieldSet>
				<FieldLegend variant="label">Recurring income sources</FieldLegend>
				<div className="flex flex-wrap gap-2">
					{incomeCandidates.map((source) => (
						<TogglePill
							key={source.id}
							name={source.name}
							detail={formatRuleDetail({ amount: source.amount })}
							checked={incomeScheduleIds.includes(source.id)}
							onToggle={() => onToggleIncomeSource(source.id)}
						/>
					))}
					{incomeScheduleIds
						.filter(
							(id) => !incomeCandidates.some((source) => source.id === id),
						)
						.map((id) => (
							<TogglePill
								key={id}
								name={`Unavailable source (${id})`}
								detail="Remove selection"
								checked
								onToggle={() => onToggleIncomeSource(id)}
							/>
						))}
				</div>
				<p className="text-sm leading-relaxed text-muted-foreground">
					Only received payments linked to selected sources count.
				</p>
				{!incomeScheduleIds.length && (
					<p className="text-sm leading-relaxed text-muted-foreground">
						Select a recurring income source.
					</p>
				)}
			</FieldSet>
			<FieldSet>
				<FieldLegend variant="label">Included bills</FieldLegend>
				{billCandidates.length ? (
					<div className="flex flex-wrap gap-2">
						{billCandidates.map((bill) => (
							<TogglePill
								key={bill.id}
								name={bill.name}
								detail={formatRuleDetail({ amount: bill.amount })}
								checked={trackedBillIds.includes(bill.id)}
								onToggle={() => onToggleBill(bill.id)}
							/>
						))}
					</div>
				) : (
					<p className="text-sm leading-relaxed text-muted-foreground">
						No recurring bills found for the selected cash accounts.
					</p>
				)}
			</FieldSet>
		</div>
	);
}
