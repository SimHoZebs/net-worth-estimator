import { useId, useMemo, useState, type FormEvent } from "react";
import { updateAccount } from "@/api/generated/endpoints.ts";
import { useEditDraft } from "../editors/useEditDraft.ts";
import { money } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { accountUpdateBody } from "../editors/accountFields.ts";
import { Checkbox, Input, InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { mergeStyles } from "../mergeStyles.ts";
import { DetailList, DetailRow } from "../DetailRow.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Notice } from "../Notice.tsx";
import { cssVariables } from "../cssVariables.ts";
import { Badge } from "../Badge.tsx";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	getServerModel,
	refreshAccounts,
} from "../../state/workspaceResources.ts";
import { parseUnion } from "../../domain/guards.ts";

function toAmountInput(value: number | null): string {
	return value === null ? "" : String(value);
}

/**
 * Direct row edit of one saved account. The `account` prop is the canonical
 * saved row; system fields (observedOn/source/color/archived) are preserved
 * from it. Saves straight to the server; failed saves keep the entered
 * values with an error, and the baseline resets only after confirmed save.
 */
export function AccountDetails({
	account,
	endingBalance,
	projected,
	readOnly: readOnlyProp,
}: {
	account: Account;
	endingBalance: number | null;
	/** Explicit forecast state for the horizon metric; never auto-requests. */
	projected?: {
		loading: boolean;
		error: string | null;
		requested: boolean;
		request: () => void;
		retry: () => void;
	};
	readOnly?: boolean;
}) {
	const id = useId();
	const edit = useEditDraft(account.id, {
		name: account.name,
		kind: account.kind,
		enabled: account.enabled,
		balance: String(account.balance),
		minBalance: String(account.minBalance),
		maxBalance: toAmountInput(account.maxBalance),
		noCeiling: account.maxBalance === null,
	});
	const { name, kind, enabled, balance, minBalance, maxBalance, noCeiling } =
		edit.value;
	const setName = (name: string) => edit.update({ name });
	const setKind = (kind: Account["kind"]) => edit.update({ kind });
	const setEnabled = (enabled: boolean) => edit.update({ enabled });
	const setBalance = (balance: string) => edit.update({ balance });
	const setMinBalance = (minBalance: string) => edit.update({ minBalance });
	const setMaxBalance = (maxBalance: string) => edit.update({ maxBalance });
	const setNoCeiling = (noCeiling: boolean) => edit.update({ noCeiling });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const readOnly = readOnlyProp ?? account.readOnly;

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

	const dirty = edit.dirty;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (readOnly || saving) return;
		if (edit.conflict) {
			setError(
				"This account changed during your edit. Discard your edits before applying new changes.",
			);
			return;
		}
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Give the account a name.");
			return;
		}
		// Blank or invalid numerics reject: silently coercing to zero can
		// invent a real floor or move the balance.
		const balanceValue = parseDisplayNumber(balance);
		if (balanceValue === null) {
			setError("Enter a balance in USD.");
			return;
		}
		const minValue = parseDisplayNumber(minBalance);
		if (minValue === null) {
			setError("Enter a protected balance in USD.");
			return;
		}
		let maxValue: number | null = null;
		if (!noCeiling) {
			if (maxBalance.trim() === "") {
				setError("Enter a maximum balance in USD or select No ceiling.");
				return;
			}
			maxValue = parseDisplayNumber(maxBalance);
			if (maxValue === null) {
				setError("Enter a maximum balance in USD or select No ceiling.");
				return;
			}
		}
		if (kind === "debt" && balanceValue > 0) {
			setError("Enter debt as a negative balance.");
			return;
		}
		if (kind !== "debt" && balanceValue < 0) {
			setError("Asset balances cannot be negative.");
			return;
		}
		if (maxValue !== null && maxValue < minValue) {
			setError("The maxBalance must be at least the protected balance.");
			return;
		}
		setSaving(true);
		setError(null);
		// Unedited bounds ride verbatim from the canonical raw account: the
		// display row clamps missing floors to 0 and missing ceilings (or the
		// no-ceiling sentinel) to null. Without a cached raw row, fall back
		// to the display baseline.
		const raw = getServerModel()?.model?.accounts.find(
			(row) => row.id === account.id,
		);
		const moved = balanceValue !== account.balance;
		const ok = await performSave({
			call: () =>
				updateAccount(account.id, {
					...accountUpdateBody({
						baseline: account,
						raw,
						values: {
							name: trimmedName,
							kind,
							enabled,
							balance: balanceValue,
							minBalance: minValue,
							maxBalance: maxValue,
							noCeiling,
						},
					}),
					...(moved
						? {
								balance: balanceValue,
								observedAt: Math.floor(Date.now() / 1000),
							}
						: {}),
				}),
			refresh: refreshAccounts,
			failureMessage: "The account could not be saved.",
		});
		setSaving(false);
		// Keep failed form values; reset the baseline only after confirmed save.
		if (ok) edit.reset();
		else
			setError(
				"The account could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => void submit(event)}
		>
			{edit.conflict && (
				<Notice tone="danger">
					This account changed during your edit.{" "}
					<button type="button" onClick={edit.reset}>
						Discard edits and use current values
					</button>
				</Notice>
			)}
			{error && <ErrorNotice message={error} />}
			<fieldset
				disabled={readOnly || saving}
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
			<DetailList className="m-0">
				<DetailRow label="Base case at horizon">
					{endingBalance !== null ? (
						money(endingBalance)
					) : projected?.loading ? (
						<span role="status">Loading forecast…</span>
					) : projected?.error ? (
						<span role="alert">
							{projected.error}{" "}
							<button type="button" onClick={projected.retry}>
								Retry forecast
							</button>
						</span>
					) : projected?.requested ? (
						// Forecast resolved but the account is absent from its balances (e.g. disabled): pre-split `?? 0` behavior, never a no-op Load button.
						money(0)
					) : projected?.request ? (
						<button type="button" onClick={projected.request}>
							Load forecast
						</button>
					) : (
						<span role="status">Forecast unavailable.</span>
					)}
				</DetailRow>
			</DetailList>
			{!readOnly && (
				<div className={mergeStyles(dialogActionsStyles, "mt-0")}>
					<Button type="submit" variant="primary" disabled={!dirty || saving}>
						{saving ? "Saving…" : "Save changes"}
					</Button>
				</div>
			)}
		</form>
	);
}
