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
import { Field, FieldDescription } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldHintClassName = "text-xs leading-relaxed text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";

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
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
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
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Add transaction</DialogTitle>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<fieldset
						disabled={saving}
						className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
					>
						<Field className="col-span-full flex min-w-0 flex-col gap-2">
							<Label htmlFor={nameId} className={fieldLabelClassName}>
								Transaction name
							</Label>
							<Input
								id={nameId}
								required
								maxLength={100}
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="e.g. Annual insurance"
								className={fieldInputClassName}
							/>
						</Field>
						<Field className="flex min-w-0 flex-col gap-2">
							<Label htmlFor={amountId} className={fieldLabelClassName}>
								Amount (USD)
							</Label>
							<Input
								id={amountId}
								type="number"
								required
								min="0"
								max="10000000000"
								step="0.01"
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
								className={fieldInputClassName}
							/>
						</Field>
						<Field className="flex min-w-0 flex-col gap-2">
							<Label htmlFor={fromIdInput} className={fieldLabelClassName}>
								From
							</Label>
							<select
								id={fromIdInput}
								value={fromId}
								onChange={(event) => setFromId(event.target.value)}
								className={fieldSelectClassName}
							>
								<option value="">External income</option>
								{savedAccounts
									.filter((account) => account.kind !== "debt")
									.map((account) => (
										<option key={account.id} value={account.id}>
											{account.name}
										</option>
									))}
							</select>
						</Field>
						<Field className="flex min-w-0 flex-col gap-2">
							<Label htmlFor={toIdInput} className={fieldLabelClassName}>
								To
							</Label>
							<select
								id={toIdInput}
								value={toId}
								onChange={(event) => setToId(event.target.value)}
								className={fieldSelectClassName}
							>
								<option value="">External expense</option>
								{savedAccounts.map((account) => (
									<option key={account.id} value={account.id}>
										{account.name}
									</option>
								))}
							</select>
						</Field>
						<Field className="flex min-w-0 flex-col gap-2">
							<Label htmlFor={dateId} className={fieldLabelClassName}>
								Date
							</Label>
							<Input
								id={dateId}
								type="date"
								required
								value={startDate}
								onChange={(event) => setStartDate(event.target.value)}
								className={fieldInputClassName}
							/>
						</Field>
						<Field className="flex min-w-0 flex-col gap-2">
							<Label htmlFor={timeId} className={fieldLabelClassName}>
								Time (UTC, optional)
							</Label>
							<Input
								id={timeId}
								type="time"
								step="1"
								aria-describedby={timeHintId}
								value={transactionTime}
								onChange={(event) => setTransactionTime(event.target.value)}
								className={fieldInputClassName}
							/>
							{timeInvalid && (
								<FieldDescription
									id={timeHintId}
									className={fieldHintClassName}
								>
									Choose a valid time.
								</FieldDescription>
							)}
						</Field>
						<Field className="flex min-w-0 flex-col gap-2">
							<Label
								htmlFor={claimScheduleIdInput}
								className={fieldLabelClassName}
							>
								Records an occurrence of
							</Label>
							<select
								id={claimScheduleIdInput}
								value={claimScheduleId}
								onChange={(event) => setClaimRuleId(event.target.value)}
								className={fieldSelectClassName}
							>
								<option value="">No link — standalone record</option>
								{claimSchedules.map((rule) => (
									<option key={rule.id} value={rule.id}>
										{rule.name}
									</option>
								))}
							</select>
						</Field>
						<Field className="flex min-w-0 flex-col gap-2">
							<Label
								htmlFor={claimOccurrenceId}
								className={fieldLabelClassName}
							>
								Replaces occurrence on
							</Label>
							<select
								id={claimOccurrenceId}
								value={claimOccurrenceDate}
								onChange={(event) => setClaimOccurrenceDate(event.target.value)}
								disabled={!claimScheduleId}
								className={fieldSelectClassName}
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
							</select>
						</Field>
						<label
							htmlFor={enabledId}
							className="flex min-h-11 items-center gap-3 text-sm text-muted"
						>
							<input
								id={enabledId}
								type="checkbox"
								checked={enabled}
								onChange={(event) => setEnabled(event.target.checked)}
								className="m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
							/>
							Include in projections
						</label>
					</fieldset>
					{error && (
						<p
							role="alert"
							className="m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text"
						>
							{error}
						</p>
					)}
					<div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-line pt-5">
						<Button
							type="button"
							variant="secondary"
							className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="secondary"
							className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
							disabled={saving || !dirty}
						>
							{saving ? "Saving…" : "Add transaction"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
