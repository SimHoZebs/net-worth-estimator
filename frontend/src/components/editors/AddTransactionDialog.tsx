import { useId, useMemo, useState, type FormEvent } from "react";
import { recordTransaction } from "@/api/generated/endpoints.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { dateLabel, todayIso } from "../../domain/format.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshTransactions,
	useTransactionCatalog,
} from "../../state/workspaceResources.ts";
import { claimOccurrenceCandidates } from "../../domain/ruleSchedule.ts";
import {
	useSavedAccounts,
	useSavedSchedules,
	useSavedStartDate,
	useSavedTransactions,
} from "../../state/savedState.ts";
import { parseDisplayNumber } from "./formValues.ts";
import {
	combineDayTime,
	transactionBody,
	validateTransactionValues,
	type TransactionFormValues,
} from "./transactionBodies.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";

/**
 * Create-only transaction form. A transaction is one fact: it has a date and
 * never a cadence. Existing rows edit through the shared TransactionDetail;
 * schedules have their own form.
 */
export function AddTransactionDialog({
	onSaved,
	onClose,
}: {
	onSaved: () => void;
	onClose: () => void;
}) {
	// Saved rows only, never the review draft (useSavedAccounts /
	// useSavedStartDate return null until their queries load).
	const savedAccountsQuery = useSavedAccounts();
	const savedStartDate = useSavedStartDate();
	const savedAccounts = useMemo(
		() => visibleAccounts(savedAccountsQuery ?? []),
		[savedAccountsQuery],
	);
	const fallbackStart = savedStartDate ?? todayIso();
	const catalog = useTransactionCatalog();
	const claimSchedules = useMemo(
		() =>
			(catalog.data?.items ?? []).filter((item) => item.kind === "schedule"),
		[catalog.data],
	);
	// The create form picks from the same scheduled occurrence list as the
	// detail editor: closest to the new transaction's own day first.
	const savedTransactions = useSavedTransactions();
	const [name, setName] = useState("");
	const [amount, setAmount] = useState("500");
	const [fromId, setFromId] = useState("");
	const [toId, setToId] = useState("");
	const [startDate, setStartDate] = useState(fallbackStart);
	const [enabled, setEnabled] = useState(true);
	const [claimScheduleId, setClaimRuleId] = useState("");
	const [claimOccurrenceDate, setClaimOccurrenceDate] = useState("");
	const savedSchedules = useSavedSchedules();
	const occurrenceOptions = useMemo(() => {
		const schedule = (savedSchedules ?? []).find(
			(row) => row.id === claimScheduleId,
		);
		if (!schedule) return [];
		const claimed = new Set<string>();
		for (const row of savedTransactions ?? []) {
			if (row.claimScheduleId === claimScheduleId && row.claimOccurrenceDate)
				claimed.add(row.claimOccurrenceDate);
		}
		if (claimOccurrenceDate) claimed.delete(claimOccurrenceDate);
		const candidates = claimOccurrenceCandidates({
			schedule,
			through: todayIso(),
			postedRef: startDate,
			claimed,
		});
		return claimOccurrenceDate && !candidates.includes(claimOccurrenceDate)
			? [claimOccurrenceDate, ...candidates]
			: candidates;
	}, [
		savedSchedules,
		claimScheduleId,
		startDate,
		claimOccurrenceDate,
		savedTransactions,
	]);
	const [saving, setSaving] = useState(false);
	const [transactionTime, setTransactionTime] = useState("");
	const [error, setError] = useState<string | null>(null);
	const enabledId = useId();

	const dirty =
		name !== "" ||
		amount !== "500" ||
		fromId !== "" ||
		toId !== "" ||
		startDate !== fallbackStart ||
		!enabled ||
		claimScheduleId !== "" ||
		claimOccurrenceDate !== "" ||
		transactionTime !== "";
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		const parsedAmount = parseDisplayNumber(amount);
		if (parsedAmount === null) {
			setError("Enter an amount of zero or more.");
			return;
		}
		const values: TransactionFormValues = {
			name: name.trim(),
			amount: parsedAmount,
			fromId: fromId || null,
			toId: toId || null,
			startDate,
			postedDate: null,
			transactionTime: combineDayTime(startDate, transactionTime),
			enabled,
			claimScheduleId: claimScheduleId || null,
			claimOccurrenceDate:
				claimScheduleId && claimOccurrenceDate ? claimOccurrenceDate : null,
		};
		const invalid = validateTransactionValues(values);
		if (invalid) {
			setError(invalid);
			return;
		}
		setSaving(true);
		setError(null);
		const id = crypto.randomUUID();
		const ok = await performSave({
			call: () => recordTransaction({ ...transactionBody(values), id }),
			refresh: refreshTransactions,
			failureMessage: "The transaction could not be saved.",
		});
		setSaving(false);
		if (ok) onSaved();
		else
			setError(
				"The transaction could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<Modal title="Add planned transaction" onClose={onClose}>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={saving}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
				>
					<InputField
						label="Transaction name"
						wide
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Annual insurance"
					/>
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
						label="Date"
						type="date"
						required
						value={startDate}
						onChange={(event) => setStartDate(event.target.value)}
					/>
					<InputField
						label="Time (UTC, optional)"
						type="time"
						step="1"
						hint="Blank means midnight UTC. Every stored time is an exact instant."
						value={transactionTime}
						onChange={(event) => setTransactionTime(event.target.value)}
					/>
					<SelectField
						label="Records an occurrence of"
						value={claimScheduleId}
						onChange={(event) => setClaimRuleId(event.target.value)}
					>
						<option value="">No link — standalone record</option>
						{claimSchedules.map((rule) => (
							<option key={rule.id} value={rule.id}>
								{rule.name}
							</option>
						))}
					</SelectField>
					<SelectField
						label="Replaces occurrence on"
						value={claimOccurrenceDate}
						onChange={(event) => setClaimOccurrenceDate(event.target.value)}
						disabled={!claimScheduleId}
					>
						<option value="">
							{!claimScheduleId
								? "Choose a schedule first"
								: occurrenceOptions.length === 0
									? "No claimable occurrences"
									: "Choose the occurrence"}
						</option>
						{occurrenceOptions.map((date) => (
							<option key={date} value={date}>
								{dateLabel(date, true)}
							</option>
						))}
					</SelectField>
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
				<ErrorNotice reserve message={error} />
				<div className={dialogActionsStyles}>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={saving || !dirty}>
						{saving ? "Saving…" : "Add transaction"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
