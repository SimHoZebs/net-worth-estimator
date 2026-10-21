import { LockKeyhole } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { money } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { type Account, type Plan, validatePlan } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { InputField, SelectField } from "../Field.tsx";
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
		<form className="account-details-form" onSubmit={submit}>
			{readOnly && (
				<div className="inline-notice">
					<LockKeyhole size={18} />
					{sourceReadOnlyReason}
				</div>
			)}
			<fieldset disabled={readOnly} className="form-grid">
				<h3 className="details-heading">Account</h3>
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
				<label className="checkbox-field">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(event) => setEnabled(event.target.checked)}
					/>
					Include in net worth and projections
				</label>
				<h3 className="details-heading">Balance & limits</h3>
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
				<fieldset className="field field-wide balance-range">
					<legend>Balance limits (USD)</legend>
					<div
						className="balance-range-track"
						role="img"
						aria-label={rangeLabel}
					>
						<div
							className="balance-range-fill"
							style={cssVariables({
								"--balance-start": `${rangeStart}%`,
								"--balance-width": `${Math.max(0, rangeEnd - rangeStart)}%`,
							})}
						/>
						<div
							className="balance-range-thumb"
							aria-hidden="true"
							style={cssVariables({ "--balance-position": `${rangeStart}%` })}
							title={`Protected ${money(numbers.minValue)}`}
						/>
						{numbers.maxValue !== null && (
							<div
								className="balance-range-thumb"
								aria-hidden="true"
								style={cssVariables({ "--balance-position": `${rangeEnd}%` })}
								title={`Ceiling ${money(numbers.maxValue)}`}
							/>
						)}
						<div
							className="balance-range-marker"
							style={cssVariables({
								"--balance-position": `${toPercent(numbers.balanceValue)}%`,
							})}
							title={`Current balance ${money(numbers.balanceValue)}`}
						/>
					</div>
					<div className="balance-range-inputs">
						<label>
							<span>Protected</span>
							<input
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
						<label>
							<span>Ceiling</span>
							<input
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
						<label className="balance-range-ceiling-toggle">
							<input
								type="checkbox"
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
				<div className="field field-wide account-source-row">
					<span id="account-source-label">Source</span>
					<div aria-labelledby="account-source-label">
						<Badge tone="outline">{account.source}</Badge>
					</div>
				</div>
			</fieldset>
			{error && <ErrorNotice message={error} />}
			<dl className="detail-list">
				<div>
					<dt>Base case at horizon</dt>
					<dd>{money(endingBalance)}</dd>
				</div>
			</dl>
			{!readOnly && (
				<div className="modal-actions">
					<button type="submit" className="button primary" disabled={!dirty}>
						Apply unsaved changes
					</button>
				</div>
			)}
		</form>
	);
}
