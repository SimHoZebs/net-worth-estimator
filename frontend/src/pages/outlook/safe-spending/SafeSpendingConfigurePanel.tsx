import { useId, useMemo } from "react";
import { AccountToggle } from "../../../components/AccountToggle.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
	Field,
	FieldError,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { Account, Transaction } from "../../../domain/model.ts";
import type {
	BillCandidate,
	SafeSpendingConfigHints,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { formatRuleDetail, TogglePill } from "./TogglePill.tsx";
import {
	SAFE_SPENDING_NUMERIC_FIELDS,
	type SafeSpendingNumericInputs,
	type SafeSpendingNumericKey,
} from "./safeSpendingDraft.ts";

export function SafeSpendingConfigurePanel({
	formId,
	config,
	numericInputs,
	dirtyNumericFields,
	dirtyTrackedIds,
	dirtySpendingIds,
	dirtyIncomeIds,
	dirtyBillIds,
	billCandidates,
	trackedBillIds,
	accounts,
	incomeCandidates,
	incomeScheduleIds,
	disabled,
	saveFailed,
	onNumericChange,
	onToggleIncomeSource,
	onToggleBill,
	onToggleAccount,
	onToggleSpendingAccount,
	onSave,
}: {
	formId: string;
	config: SafeSpendingConfigHints;
	numericInputs: SafeSpendingNumericInputs;
	dirtyNumericFields: Record<SafeSpendingNumericKey, boolean>;
	dirtyTrackedIds: ReadonlySet<string>;
	dirtySpendingIds: ReadonlySet<string>;
	dirtyIncomeIds: ReadonlySet<string>;
	dirtyBillIds: ReadonlySet<string>;
	billCandidates: BillCandidate[];
	trackedBillIds: string[];
	accounts: Account[];
	incomeCandidates: Transaction[];
	incomeScheduleIds: string[];
	disabled: boolean;
	saveFailed: boolean;
	onNumericChange: (key: SafeSpendingNumericKey, value: string) => void;
	onToggleIncomeSource: (id: string) => void;
	onToggleBill: (transactionId: string) => void;
	onToggleAccount: (accountId: string) => void;
	onToggleSpendingAccount: (accountId: string) => void;
	onSave: () => Promise<void>;
}) {
	const accountsById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	const fieldId = useId();
	return (
		<form
			id={formId}
			aria-labelledby={`${fieldId}-budget`}
			className="grid content-start gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				void onSave();
			}}
		>
			{saveFailed && (
				<FieldError>
					Changes were not saved. Review the values and try again.
				</FieldError>
			)}
			<FieldSet>
				<FieldLegend
					id={`${fieldId}-budget`}
					variant="label"
					className="sr-only"
				>
					Budget settings
				</FieldLegend>
				{SAFE_SPENDING_NUMERIC_FIELDS.map(
					({ key, label, min, step, ...limits }) => {
						const id = `${fieldId}-${key}`;
						const dirty = dirtyNumericFields[key];
						return (
							<Field key={key}>
								<div className="flex items-center justify-between gap-2">
									<Label htmlFor={id}>{label}</Label>
									{dirty && (
										<Badge
											id={`${id}-unsaved`}
											variant="outline"
											className="border-warning-border bg-warning-bg text-warning-text"
										>
											Unsaved
										</Badge>
									)}
								</div>
								<Input
									id={id}
									name={key}
									type="number"
									min={min}
									step={step}
									{...limits}
									required
									disabled={disabled}
									aria-describedby={dirty ? `${id}-unsaved` : undefined}
									value={numericInputs[key]}
									onChange={(event) => onNumericChange(key, event.target.value)}
									className={
										dirty ? "border-warning-border bg-warning-bg" : undefined
									}
								/>
							</Field>
						);
					},
				)}
			</FieldSet>
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
								disabled={disabled}
								dirty={dirtySpendingIds.has(account.id)}
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
								disabled={disabled}
								dirty={dirtyTrackedIds.has(card.id)}
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
							disabled={disabled}
							dirty={dirtyIncomeIds.has(source.id)}
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
								disabled={disabled}
								dirty={dirtyIncomeIds.has(id)}
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
								disabled={disabled}
								dirty={dirtyBillIds.has(bill.id)}
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
		</form>
	);
}
