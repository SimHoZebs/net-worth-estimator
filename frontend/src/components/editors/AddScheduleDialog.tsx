import { useId, useMemo, useState, type FormEvent } from "react";
import { createSchedule } from "@/api/generated/endpoints.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { refreshTransactions } from "../../state/workspaceResources.ts";
import { useSavedAccounts, useSavedStartDate } from "../../state/savedState.ts";
import { parseDisplayNumber } from "./formValues.ts";
import {
	scheduleBody,
	validateScheduleValues,
	type ScheduleFormValues,
} from "./transactionBodies.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";
import type { Frequency } from "../../api/contracts.ts";

/** Create-only schedule form. Recurrence, growth, and the end date live here. */
export function AddScheduleDialog({
	onSaved,
	onClose,
}: {
	onSaved: () => void;
	onClose: () => void;
}) {
	const savedAccountsQuery = useSavedAccounts();
	const savedStartDate = useSavedStartDate();
	const savedAccounts = useMemo(
		() => visibleAccounts(savedAccountsQuery ?? []),
		[savedAccountsQuery],
	);
	const fallbackStart = savedStartDate ?? todayIso();
	const [name, setName] = useState("");
	const [amount, setAmount] = useState("500");
	const [amountKind, setAmountKind] = useState<"fixed" | "growth">("fixed");
	const [annualIncrease, setAnnualIncrease] = useState("3");
	const [frequency, setFrequency] = useState<Frequency>("monthly");
	const [fromId, setFromId] = useState("");
	const [toId, setToId] = useState("");
	const [startDate, setStartDate] = useState(fallbackStart);
	const [noEndDate, setNoEndDate] = useState(true);
	const [endDate, setEndDate] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const enabledId = useId();
	const noEndDateId = useId();

	const dirty =
		name !== "" ||
		amount !== "500" ||
		amountKind !== "fixed" ||
		annualIncrease !== "3" ||
		frequency !== "monthly" ||
		fromId !== "" ||
		toId !== "" ||
		startDate !== fallbackStart ||
		!noEndDate ||
		endDate !== "" ||
		!enabled;
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		const parsedAmount = parseDisplayNumber(amount);
		if (parsedAmount === null) {
			setError("Enter an amount of zero or more.");
			return;
		}
		const growth =
			amountKind === "growth"
				? (parseDisplayNumber(annualIncrease) ?? Number.NaN)
				: 0;
		const values: ScheduleFormValues = {
			name: name.trim(),
			amount: parsedAmount,
			annualIncrease: growth,
			fromId: fromId || null,
			toId: toId || null,
			frequency,
			startDate,
			endDate: !noEndDate && endDate ? endDate : null,
			enabled,
		};
		const invalid = validateScheduleValues(values);
		if (invalid) {
			setError(invalid);
			return;
		}
		setSaving(true);
		setError(null);
		const id = crypto.randomUUID();
		const ok = await performSave({
			call: () => createSchedule({ ...scheduleBody(values), id }),
			refresh: refreshTransactions,
			failureMessage: "The schedule could not be saved.",
		});
		setSaving(false);
		if (ok) onSaved();
		else
			setError(
				"The schedule could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<Modal title="Add schedule" onClose={onClose}>
			{error && <ErrorNotice message={error} />}
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={saving}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
				>
					<InputField
						label="Schedule name"
						wide
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Monthly investing"
					/>
					<SelectField
						label="How is the amount calculated?"
						value={amountKind}
						onChange={(event) =>
							setAmountKind(
								event.target.value === "growth" ? "growth" : "fixed",
							)
						}
					>
						<option value="fixed">Fixed amount</option>
						<option value="growth">Grows yearly by %</option>
					</SelectField>
					<InputField
						label="Amount (USD)"
						type="number"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={amount}
						onChange={(event) => setAmount(event.target.value)}
					/>
					{amountKind === "growth" && (
						<InputField
							label="Annual amount increase (%)"
							type="number"
							required
							min="-50"
							max="50"
							step="0.1"
							value={annualIncrease}
							onChange={(event) => setAnnualIncrease(event.target.value)}
						/>
					)}
					<SelectField
						label="Frequency"
						value={frequency}
						onChange={(event) => {
							const next = parseUnion(event.target.value, [
								"daily",
								"weekly",
								"monthly",
								"quarterly",
								"annual",
							] as const);
							if (next) setFrequency(next);
						}}
					>
						<option value="daily">Daily</option>
						<option value="weekly">Weekly</option>
						<option value="monthly">Monthly</option>
						<option value="quarterly">Every 3 months</option>
						<option value="annual">Yearly</option>
					</SelectField>
					<SelectField
						label="From"
						value={fromId}
						onChange={(event) => setFromId(event.target.value)}
					>
						<option value="">External income</option>
						{savedAccounts
							.filter((account) => account.kind !== "debt")
							.map((account) => (
								<option key={account.id} value={account.id}>
									{account.name}
								</option>
							))}
					</SelectField>
					<SelectField
						label="To"
						value={toId}
						onChange={(event) => setToId(event.target.value)}
					>
						<option value="">External expense</option>
						{savedAccounts.map((account) => (
							<option key={account.id} value={account.id}>
								{account.name}
							</option>
						))}
					</SelectField>
					<InputField
						label="First occurrence"
						type="date"
						required
						value={startDate}
						onChange={(event) => setStartDate(event.target.value)}
					/>
					<InputField
						label="Last occurrence"
						type="date"
						disabled={noEndDate}
						value={endDate}
						onChange={(event) => setEndDate(event.target.value)}
					/>
					<label
						htmlFor={noEndDateId}
						className="flex min-h-11 items-center gap-3 text-sm text-muted"
					>
						<Checkbox
							id={noEndDateId}
							checked={noEndDate}
							onChange={(event) => setNoEndDate(event.target.checked)}
						/>
						No end date
					</label>
					<label
						htmlFor={enabledId}
						className="flex min-h-11 items-center gap-3 text-sm text-muted"
					>
						<Checkbox
							id={enabledId}
							checked={enabled}
							onChange={(event) => setEnabled(event.target.checked)}
						/>
						Include in projections
					</label>
				</fieldset>
				<div className={dialogActionsStyles}>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={saving || !dirty}>
						{saving ? "Saving…" : "Add schedule"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
