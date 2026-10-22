import { useId, useMemo } from "react";
import { AccountLabel } from "../../../components/AccountIcon.tsx";
import { TextButton } from "../../../components/Button.tsx";
import { Checkbox, InputField } from "../../../components/Field.tsx";
import { dateLabel, exactMoney, money } from "../../../domain/format.ts";
import type { Plan } from "../../../domain/model.ts";
import type {
	SafeSpendingResetKey,
	TotalCycleSettings,
} from "../../../state/useSafeSpendingSettings.ts";
import type {
	BillCandidate,
	SafeSpendingConfigHints,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

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
			className="group cursor-pointer rounded-control border border-line-strong bg-surface py-1.5 pr-3 pl-1.5 text-left text-xs transition-[border-color,background] duration-150 hover:bg-hover aria-pressed:border-primary aria-pressed:bg-success-bg motion-reduce:transition-none"
			aria-pressed={checked}
			onClick={onToggle}
		>
			<AccountLabel
				account={account}
				className="group-aria-[pressed=false]:opacity-55"
				nameClassName="group-aria-[pressed=false]:text-muted"
			/>
		</button>
	);
}

export function SafeSpendingConfigurePanel({
	config,
	billCandidates,
	trackedBillIds,
	accounts,
	onToggleBill,
	onToggleAccount,
	onToggleSpendingAccount,
	onUpdateConfig,
	onResetConfig,
}: {
	config: SafeSpendingConfigHints;
	billCandidates: BillCandidate[];
	trackedBillIds: string[];
	accounts: Plan["accounts"];
	onToggleBill: (movementId: string) => void;
	onToggleAccount: (accountId: string) => void;
	onToggleSpendingAccount: (accountId: string) => void;
	onUpdateConfig: (next: Partial<TotalCycleSettings>) => void;
	onResetConfig: (key: SafeSpendingResetKey) => void;
}) {
	const billsId = useId();
	const accountsById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	const overrideFields = [
		{
			key: "checking",
			label: labels.cashBalance,
			automatic: config.checkingHint ?? 0,
			source: `${exactMoney(config.checkingHint ?? 0)} from selected cash accounts`,
			effect: `Changes ${labels.cashBalance} and ${labels.cashAfterBills}. ${labels.allowance} stays unchanged.`,
		},
		{
			key: "remaining",
			label: labels.remainingBills,
			automatic: config.remainingHint.total,
			source: `${exactMoney(config.remainingHint.total)} through ${dateLabel(config.remainingHint.monthEnd, true)}`,
			effect: `Changes ${labels.remainingBills} and ${labels.cashAfterBills}. The ${labels.scheduledBills} list stays unchanged.`,
		},
		{
			key: "paycheck",
			label: labels.nextPaycheck,
			automatic: config.paycheckHint?.amount ?? 0,
			source: config.paycheckHint
				? `${exactMoney(config.paycheckHint.amount)} on ${dateLabel(config.paycheckHint.date, true)}`
				: "$0.00. No upcoming paycheck in the projection",
			effect: `Changes ${labels.allowance} in This cycle and ${labels.unallocated} in Last cycle.`,
		},
		{
			key: "fixed",
			label: labels.fixedBills,
			automatic: config.fixedHint.total,
			source: `${exactMoney(config.fixedHint.total)} for ${dateLabel(config.fixedHint.start, true)} to ${dateLabel(config.fixedHint.end, true)}`,
			effect: `Reduces ${labels.allowance} in This cycle and ${labels.unallocated} in Last cycle.`,
		},
		{
			key: "spent",
			label: labels.cardSpending,
			automatic: config.spentHint,
			source: `${exactMoney(config.spentHint)} from this cycle's recorded card charges`,
			effect: `Changes ${labels.cardSpending} and ${labels.allowance} in This cycle. ${labels.recordedCharges} and ${labels.closedCards} stay unchanged.`,
		},
	] satisfies {
		key: SafeSpendingResetKey;
		label: string;
		automatic: number;
		source: string;
		effect: string;
	}[];
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
						statementDay: Math.min(
							28,
							Math.max(1, Math.floor(Number(event.target.value) || 20)),
						),
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
			{overrideFields.map((field) => {
				const setting = `${field.key}Override` as const;
				const value = config[setting];
				return (
					<div key={field.key}>
						<InputField
							label={`${field.label} ($)`}
							hint={`${value === null ? "Automatic value active." : "Override active."} Automatic: ${field.source}. ${field.effect} Leave empty to use the automatic value.`}
							type="number"
							min={0}
							step="0.01"
							placeholder={String(field.automatic)}
							value={value ?? ""}
							onChange={(event) =>
								onUpdateConfig({
									[setting]:
										event.target.value === ""
											? null
											: Math.max(0, Number(event.target.value) || 0),
								})
							}
						/>
						{value !== null && (
							<TextButton onClick={() => onResetConfig(field.key)}>
								Use automatic {field.label}
							</TextButton>
						)}
					</div>
				);
			})}
			<fieldset className="grid gap-2">
				<legend className="m-0 p-0 text-xs font-semibold text-muted">
					{labels.cashAccounts}
				</legend>
				<p className="text-sm leading-relaxed text-muted">
					Feeds automatic {labels.cashBalance}, {labels.nextPaycheck},{" "}
					{labels.remainingBills}, {labels.fixedBills}, and{" "}
					{labels.cashPayments}. Overrides keep their entered values.
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
					{labels.recordedCharges} lists. Overrides keep their entered totals.
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
					{labels.cashPayments}. Also changes {labels.scheduledBills}. Overrides
					keep their entered totals.
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
