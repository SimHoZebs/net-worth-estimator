import { useId, useMemo } from "react";
import { AccountToggle } from "../../../components/AccountToggle.tsx";
import { Field, FieldLegend, FieldSet } from "@/components/ui/field.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import type {
	BillCandidate,
	SafeSpendingConfigHints,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { formatRuleDetail, TogglePill } from "./TogglePill.tsx";

const budgetFields = [
	{ key: "cycleStartDay", label: "Cycle start day", min: 1, max: 31, step: 1 },
	{ key: "paydayDay", label: "Payday of month", min: 1, max: 31, step: 1 },
	{
		key: "savingsTarget",
		label: "Monthly savings goal ($)",
		min: 0,
		step: 0.01,
	},
] as const;

export function SafeSpendingConfigurePanel({
	config,
	billCandidates,
	trackedBillIds,
	accounts,
	incomeCandidates,
	incomeScheduleIds,
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
	incomeCandidates: Transaction[];
	incomeScheduleIds: string[];
	onToggleIncomeSource: (id: string) => void;
	onToggleBill: (transactionId: string) => void;
	onToggleAccount: (accountId: string) => void;
	onToggleSpendingAccount: (accountId: string) => void;
	onUpdateConfig: (next: Partial<SafeSpendingSettings>) => void;
}) {
	const accountsById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	const fieldId = useId();
	return (
		<div className="grid content-start gap-3">
			<form
				aria-labelledby={`${fieldId}-budget`}
				onSubmit={(event) => {
					event.preventDefault();
					const fields = new FormData(event.currentTarget);
					const next: Partial<SafeSpendingSettings> = {};
					for (const { key } of budgetFields) {
						const value = Number(fields.get(key));
						if (value !== config[key]) next[key] = value;
					}
					if (Object.keys(next).length) onUpdateConfig(next);
				}}
			>
				<FieldSet>
					<FieldLegend id={`${fieldId}-budget`} variant="label">
						Monthly budget
					</FieldLegend>
					<p
						id={`${fieldId}-dates`}
						className="text-sm leading-relaxed text-muted-foreground"
					>
						Days 1–31 · Short months: last day
					</p>
					{budgetFields.map(({ key, label, min, step, ...limits }) => {
						const id = `${fieldId}-${key}`;
						return (
							<Field key={key}>
								<Label htmlFor={id}>{label}</Label>
								<Input
									key={config[key]}
									id={id}
									name={key}
									type="number"
									min={min}
									step={step}
									{...limits}
									required
									aria-describedby={`${fieldId}-dates`}
									defaultValue={config[key]}
								/>
							</Field>
						);
					})}
					<Button
						className="justify-self-start self-start"
						type="submit"
						variant="outline"
					>
						Save monthly budget
					</Button>
				</FieldSet>
			</form>
			<Field>
				<Label htmlFor={`${fieldId}-reserve`}>{`${labels.reserve} ($)`}</Label>
				<Input
					id={`${fieldId}-reserve`}
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
								detail={
									bill.amount === null
										? "Calculated amount"
										: formatRuleDetail({ amount: bill.amount })
								}
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
