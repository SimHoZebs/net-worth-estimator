import { LockKeyhole } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { money } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { type Account, type Plan, validatePlan } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { Checkbox, Input, InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { mergeStyles } from "../mergeStyles.ts";
import { DetailList, DetailRow } from "../DetailRow.tsx";
import { Notice } from "../Notice.tsx";
import { cssVariables } from "../cssVariables.ts";
import { Badge, ErrorNotice } from "../ui.tsx";
import { sourceReadOnlyReason } from "../editors/EditorForm.tsx";

function toAmountInput(value: number | null): string {
	return value === null ? "" : String(value);
}

export function AccountDetails({
	account,
	plan,
	endingBalance,
	onApply,
}: {
	account: Account;
	plan: Plan;
	endingBalance: number;
	onApply: (plan: Plan) => boolean;
}) {
	const id = useId();
	const [name, setName] = useState(account.name);
	const [kind, setKind] = useState<Account["kind"]>(account.kind);
	const [enabled, setEnabled] = useState(account.enabled);
	const [balance, setBalance] = useState(String(account.balance));
	const [minBalance, setMinBalance] = useState(String(account.minBalance));
	const [maxBalance, setMaxBalance] = useState(
		toAmountInput(account.maxBalance),
	);
	const [noCeiling, setNoCeiling] = useState(account.maxBalance === null);
	const [error, setError] = useState<string | null>(null);

	const readOnly = account.readOnly;

	const numbers = useMemo(() => {
		const balanceValue = parseDisplayNumber(balance) ?? 0;
		const minValue = parseDisplayNumber(minBalance) ?? 0;
		const maxValue = noCeiling
			? null
			: (parseDisplayNumber(maxBalance) ?? null);
		return { balanceValue, minValue, maxValue };
	}, [balance, minBalance, maxBalance, noCeiling]);

	const scaleMax = Math.max(
		1,
		numbers.balanceValue,
		numbers.minValue,
		numbers.maxValue ?? 0,
	);
	const toPercent = (value: number) =>
		Math.min(100, Math.max(0, (value / scaleMax) * 100));
	const rangeStart = toPercent(numbers.minValue);
	const rangeEnd =
		numbers.maxValue === null ? 100 : toPercent(numbers.maxValue);
	const rangeLabel =
		numbers.maxValue === null
			? `Balance limits from ${money(numbers.minValue)}, no upper limit`
			: `Balance limits from ${money(numbers.minValue)} to ${money(numbers.maxValue)}`;

	const dirty =
		name !== account.name ||
		kind !== account.kind ||
		enabled !== account.enabled ||
		balance !== String(account.balance) ||
		minBalance !== String(account.minBalance) ||
		toAmountInput(account.maxBalance) !== (noCeiling ? "" : maxBalance) ||
		noCeiling !== (account.maxBalance === null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (readOnly) return;
		const trimmedName = name.trim();
		const balanceValue = parseDisplayNumber(balance) ?? 0;
		const minValue = parseDisplayNumber(minBalance) ?? 0;
		const maxValue = noCeiling
			? null
			: maxBalance.trim()
				? (parseDisplayNumber(maxBalance) ?? 0)
				: null;
		const next: Account = {
			...account,
			name: trimmedName,
			kind,
			enabled,
			balance: balanceValue,
			minBalance: minValue,
			maxBalance: maxValue,
			// The observation date is system-owned (projection start or the
			// latest checkpoint). It is never edited here; the stored value
			// is preserved so the balance keeps its observation date.
			observedOn: account.observedOn,
			// Source is display provenance only. It is never edited here; the
			// stored value is preserved so edits cannot change it.
			source: account.source,
			readOnly: false,
		};
		const validated = validatePlan({
			...plan,
			accounts: upsertItem({ items: plan.accounts, item: next }),
		});
		if (validated instanceof Error) {
			setError(validated.message);
			return;
		}
		setError(null);
		onApply(validated);
	};

	return (
		<form className="flex flex-col gap-4" onSubmit={submit}>
			{readOnly && (
				<Notice>
					<LockKeyhole size={18} className="mt-px" aria-hidden="true" />
					{sourceReadOnlyReason}
				</Notice>
			)}
			<fieldset
				disabled={readOnly}
				className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
			>
				<h3 className="col-span-full mt-3 border-t border-line pt-4 text-xs font-semibold text-ink first:mt-0 first:border-t-0 first:pt-0 max-sm:mt-2 max-sm:pt-3">
					Account
				</h3>
				<InputField
					label="Account name"
					wide
					value={name}
					maxLength={100}
					required
					onChange={(event) => setName(event.target.value)}
					placeholder="e.g. Savings account"
				/>
				<SelectField
					label="Account type"
					value={kind}
					onChange={(event) =>
						setKind(
							parseUnion(event.target.value, [
								"cash",
								"investment",
								"property",
								"debt",
							] as const) ?? "cash",
						)
					}
				>
					<option value="cash">Cash & savings</option>
					<option value="investment">Investments</option>
					<option value="property">Property</option>
					<option value="debt">Debt</option>
				</SelectField>
				<label
					htmlFor={`${id}-enabled`}
					className="flex items-center gap-2 text-xs text-muted"
				>
					<Checkbox
						id={`${id}-enabled`}
						checked={enabled}
						onChange={(event) => setEnabled(event.target.checked)}
					/>
					Include in net worth and projections
				</label>
				<h3 className="col-span-full mt-3 border-t border-line pt-4 text-xs font-semibold text-ink first:mt-0 first:border-t-0 first:pt-0 max-sm:mt-2 max-sm:pt-3">
					Balance & limits
				</h3>
				<InputField
					label="Balance (USD)"
					type="number"
					required
					step="0.01"
					min="-10000000000"
					max="10000000000"
					value={balance}
					onChange={(event) => setBalance(event.target.value)}
				/>
				<fieldset className="col-span-full m-0 flex min-w-0 flex-col gap-2 border-0 p-0 text-sm font-semibold text-muted max-sm:text-xs">
					<legend className="mb-2 p-0 text-xs font-semibold text-muted">
						Balance limits (USD)
					</legend>
					<div
						className="relative h-3 overflow-visible rounded-full border border-line bg-surface-3"
						role="img"
						aria-label={rangeLabel}
					>
						<div
							className="absolute inset-y-0 left-(--balance-start) w-(--balance-width) rounded-full bg-primary"
							style={cssVariables({
								"--balance-start": `${rangeStart}%`,
								"--balance-width": `${Math.max(0, rangeEnd - rangeStart)}%`,
							})}
						/>
						<div
							className="absolute top-1/2 left-(--balance-position) size-4 -translate-1/2 rounded-full border-2 border-primary bg-input-bg shadow-xs"
							aria-hidden="true"
							style={cssVariables({ "--balance-position": `${rangeStart}%` })}
							title={`Protected ${money(numbers.minValue)}`}
						/>
						{numbers.maxValue !== null && (
							<div
								className="absolute top-1/2 left-(--balance-position) size-4 -translate-1/2 rounded-full border-2 border-primary bg-input-bg shadow-xs"
								aria-hidden="true"
								style={cssVariables({ "--balance-position": `${rangeEnd}%` })}
								title={`Ceiling ${money(numbers.maxValue)}`}
							/>
						)}
						<div
							className="absolute -inset-y-1 left-(--balance-position) w-0.5 -translate-x-px bg-ink"
							style={cssVariables({
								"--balance-position": `${toPercent(numbers.balanceValue)}%`,
							})}
							title={`Current balance ${money(numbers.balanceValue)}`}
						/>
					</div>
					<div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-3 max-sm:grid-cols-2">
						<label htmlFor={`${id}-protected`} className="flex flex-col gap-2">
							<span>Protected</span>
							<Input
								id={`${id}-protected`}
								type="number"
								aria-label="Protected balance in USD"
								min="0"
								max="10000000000"
								step="0.01"
								required
								value={minBalance}
								onChange={(event) => setMinBalance(event.target.value)}
							/>
						</label>
						<label htmlFor={`${id}-ceiling`} className="flex flex-col gap-2">
							<span>Ceiling</span>
							<Input
								id={`${id}-ceiling`}
								type="number"
								aria-label="Maximum balance in USD"
								min="0"
								max="10000000000"
								step="0.01"
								disabled={noCeiling}
								value={noCeiling ? "" : maxBalance}
								placeholder="No ceiling"
								onChange={(event) => setMaxBalance(event.target.value)}
							/>
						</label>
						<label
							htmlFor={`${id}-no-ceiling`}
							className="flex flex-row items-center gap-2 pb-3 whitespace-nowrap max-sm:col-span-full max-sm:pb-0"
						>
							<Checkbox
								id={`${id}-no-ceiling`}
								checked={noCeiling}
								onChange={(event) => {
									setNoCeiling(event.target.checked);
									if (!event.target.checked && maxBalance === "")
										setMaxBalance(String(numbers.minValue));
								}}
							/>
							No ceiling
						</label>
					</div>
				</fieldset>
				<div className="col-span-full flex flex-col gap-2 text-sm font-semibold text-muted max-sm:text-xs">
					<span id="account-source-label">Source</span>
					<div className="flex" aria-labelledby="account-source-label">
						<Badge tone="outline">{account.source}</Badge>
					</div>
				</div>
			</fieldset>
			{error && <ErrorNotice message={error} />}
			<DetailList className="m-0">
				<DetailRow label="Base case at horizon">
					{money(endingBalance)}
				</DetailRow>
			</DetailList>
			{!readOnly && (
				<div className={mergeStyles(dialogActionsStyles, "mt-0")}>
					<Button type="submit" variant="primary" disabled={!dirty}>
						Apply unsaved changes
					</Button>
				</div>
			)}
		</form>
	);
}
