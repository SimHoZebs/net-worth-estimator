import { useMemo } from "react";
import { AccountLabel } from "../../../components/AccountIcon.tsx";
import { dateLabel, money } from "../../../domain/format.ts";
import type { Plan } from "../../../domain/model.ts";
import type {
	SafeSpendingResetKey,
	TotalCycleSettings,
} from "../../../state/useSafeSpendingSettings.ts";
import type {
	BillCandidate,
	SafeSpendingConfigHints,
} from "./safeSpendingDetailModel.ts";

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
			className="account-toggle table-name"
			aria-pressed={checked}
			onClick={onToggle}
		>
			<AccountLabel account={account} />
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
	const accountsById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	return (
		<div className="cycle-config">
			<label className="field">
				<span>Statement starts on day (1–28)</span>
				<input
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
			</label>
			<label className="field">
				<span>
					Expected next paycheck ($) —{" "}
					{config.paycheckHint
						? `${money(config.paycheckHint.amount)} on ${dateLabel(config.paycheckHint.date, true)}`
						: "no upcoming inflow in projection"}
				</span>
				<input
					type="number"
					min={0}
					step="10"
					placeholder={String(Math.round(config.paycheckHint?.amount ?? 0))}
					value={config.paycheckOverride ?? ""}
					onChange={(event) =>
						onUpdateConfig({
							paycheckOverride:
								event.target.value === ""
									? null
									: Math.max(0, Number(event.target.value) || 0),
						})
					}
				/>
			</label>
			{config.paycheckOverride !== null && (
				<button
					type="button"
					className="text-button"
					onClick={() => onResetConfig("paycheck")}
				>
					Use projected {money(config.paycheckHint?.amount ?? 0)} instead
				</button>
			)}
			<label className="field">
				<span>
					Next month fixed obligations ($) — {money(config.fixedHint.total)} for{" "}
					{dateLabel(config.fixedHint.start, true)} to{" "}
					{dateLabel(config.fixedHint.end, true)}
				</span>
				<input
					type="number"
					min={0}
					step="10"
					placeholder={String(Math.round(config.fixedHint.total))}
					value={config.fixedOverride ?? ""}
					onChange={(event) =>
						onUpdateConfig({
							fixedOverride:
								event.target.value === ""
									? null
									: Math.max(0, Number(event.target.value) || 0),
						})
					}
				/>
			</label>
			{config.fixedOverride !== null && (
				<button
					type="button"
					className="text-button"
					onClick={() => onResetConfig("fixed")}
				>
					Use projected {money(config.fixedHint.total)} instead
				</button>
			)}
			<label className="field">
				<span>Protected reserve ($)</span>
				<input
					type="number"
					min={0}
					step="5"
					value={config.reserve}
					onChange={(event) =>
						onUpdateConfig({
							reserve: Math.max(0, Number(event.target.value) || 0),
						})
					}
				/>
			</label>
			<label className="field">
				<span>
					Actual spent ($) — empty uses {money(config.spentHint)} tracked
				</span>
				<input
					type="number"
					min={0}
					step="1"
					placeholder={String(Math.round(config.spentHint))}
					value={config.spentOverride ?? ""}
					onChange={(event) =>
						onUpdateConfig({
							spentOverride:
								event.target.value === ""
									? null
									: Math.max(0, Number(event.target.value) || 0),
						})
					}
				/>
			</label>
			{config.spentOverride !== null && (
				<button
					type="button"
					className="text-button"
					onClick={() => onResetConfig("spent")}
				>
					Use tracked {money(config.spentHint)} instead
				</button>
			)}
			<label className="field">
				<span>
					Available balance ($) — {money(config.checkingHint ?? 0)} in plan
				</span>
				<input
					type="number"
					min={0}
					step="10"
					placeholder={String(Math.round(config.checkingHint ?? 0))}
					value={config.checkingOverride ?? ""}
					onChange={(event) =>
						onUpdateConfig({
							checkingOverride:
								event.target.value === ""
									? null
									: Math.max(0, Number(event.target.value) || 0),
						})
					}
				/>
			</label>
			{config.checkingOverride !== null && (
				<button
					type="button"
					className="text-button"
					onClick={() => onResetConfig("checking")}
				>
					Use plan {money(config.checkingHint ?? 0)} instead
				</button>
			)}
			<fieldset className="cycle-accounts">
				<legend>Accounts in available balance</legend>
				<div className="account-toggles">
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
			<label className="field">
				<span>
					Remaining bills this month ($) — {money(config.remainingHint.total)}{" "}
					through {dateLabel(config.remainingHint.monthEnd, true)}
				</span>
				<input
					type="number"
					min={0}
					step="10"
					placeholder={String(Math.round(config.remainingHint.total))}
					value={config.remainingOverride ?? ""}
					onChange={(event) =>
						onUpdateConfig({
							remainingOverride:
								event.target.value === ""
									? null
									: Math.max(0, Number(event.target.value) || 0),
						})
					}
				/>
			</label>
			{config.remainingOverride !== null && (
				<button
					type="button"
					className="text-button"
					onClick={() => onResetConfig("remaining")}
				>
					Use projected {money(config.remainingHint.total)} instead
				</button>
			)}
			<fieldset className="cycle-accounts">
				<legend>Cards in cycle total</legend>
				<div className="account-toggles">
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
			<fieldset className="cycle-accounts">
				<legend>Recurring payments in this total</legend>
				{billCandidates.length ? (
					billCandidates.map((bill) => {
						const checked = trackedBillIds.includes(bill.id);
						return (
							<label key={bill.id} className="cycle-account-option">
								<input
									type="checkbox"
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
					<p className="section-note">
						No recurring checking outflows found in the plan.
					</p>
				)}
			</fieldset>
		</div>
	);
}
