import { useId, useMemo, useState } from "react";
import { recordTransaction } from "@/api/generated/endpoints.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { dateLabel, todayIso } from "../../domain/format.ts";
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
import { EditorDialog } from "./EditorDialog.tsx";
import {
	EditorCheckbox,
	EditorField,
	EditorSelect,
	MoneyField,
} from "./editorFields.tsx";
import { Input } from "@/components/ui/input.tsx";

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
	const timeInvalid =
		transactionTime !== "" &&
		!Number.isFinite(combineDayTime(startDate, transactionTime));
	const enabledId = useId();
	const nameId = useId();
	const amountId = useId();
	const fromIdInput = useId();
	const toIdInput = useId();
	const dateId = useId();
	const timeId = useId();
	const claimScheduleIdInput = useId();
	const claimOccurrenceId = useId();
	const timeHintId = timeInvalid ? `${timeId}-hint` : undefined;

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

	const submit = async () => {
		if (saving) return;
		if (timeInvalid) {
			setError("Choose a valid time.");
			return;
		}
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
		<EditorDialog
			title="Add transaction"
			onClose={onClose}
			dirty={dirty}
			busy={saving}
			error={error}
			submitLabel="Add transaction"
			submitDisabled={!dirty}
			onSubmit={() => void submit()}
		>
			<fieldset
				disabled={saving}
				className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1"
			>
				<EditorField
					label="Transaction name"
					htmlFor={nameId}
					className="col-span-full"
				>
					<Input
						id={nameId}
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Annual insurance"
						disabled={saving}
					/>
				</EditorField>
				<MoneyField
					id={amountId}
					label="Amount"
					required
					min="0"
					max="10000000000"
					step="0.01"
					value={amount}
					onChange={(event) => setAmount(event.target.value)}
					disabled={saving}
				/>
				<EditorField label="From" htmlFor={fromIdInput}>
					<EditorSelect
						id={fromIdInput}
						value={fromId}
						onValueChange={setFromId}
						emptyLabel="External income"
						options={savedAccounts
							.filter((account) => account.kind !== "debt")
							.map((account) => ({
								value: account.id,
								label: account.name,
							}))}
						disabled={saving}
					/>
				</EditorField>
				<EditorField label="To" htmlFor={toIdInput}>
					<EditorSelect
						id={toIdInput}
						value={toId}
						onValueChange={setToId}
						emptyLabel="External expense"
						options={savedAccounts.map((account) => ({
							value: account.id,
							label: account.name,
						}))}
						disabled={saving}
					/>
				</EditorField>
				<EditorField label="Date" htmlFor={dateId}>
					<Input
						id={dateId}
						type="date"
						required
						value={startDate}
						onChange={(event) => setStartDate(event.target.value)}
						disabled={saving}
					/>
				</EditorField>
				<EditorField
					label="Time (UTC, optional)"
					htmlFor={timeId}
					hint={timeInvalid ? "Choose a valid time." : undefined}
					hintId={timeHintId}
				>
					<Input
						id={timeId}
						type="time"
						step="1"
						aria-describedby={timeHintId}
						value={transactionTime}
						onChange={(event) => setTransactionTime(event.target.value)}
						disabled={saving}
					/>
				</EditorField>
				<EditorField
					label="Records an occurrence of"
					htmlFor={claimScheduleIdInput}
				>
					<EditorSelect
						id={claimScheduleIdInput}
						value={claimScheduleId}
						onValueChange={setClaimRuleId}
						emptyLabel="No link — standalone record"
						options={claimSchedules.map((rule) => ({
							value: rule.id,
							label: rule.name,
						}))}
						disabled={saving}
					/>
				</EditorField>
				<EditorField label="Replaces occurrence on" htmlFor={claimOccurrenceId}>
					<EditorSelect
						id={claimOccurrenceId}
						value={claimOccurrenceDate}
						onValueChange={setClaimOccurrenceDate}
						emptyLabel={
							!claimScheduleId
								? "Choose a schedule first"
								: occurrenceOptions.length === 0
									? "No claimable occurrences"
									: "Choose the occurrence"
						}
						options={occurrenceOptions.map((date) => ({
							value: date,
							label: dateLabel(date, true),
						}))}
						disabled={saving || !claimScheduleId}
					/>
				</EditorField>
				<EditorCheckbox
					id={enabledId}
					label="Include in projections"
					checked={enabled}
					onChange={setEnabled}
					disabled={saving}
				/>
			</fieldset>
		</EditorDialog>
	);
}
