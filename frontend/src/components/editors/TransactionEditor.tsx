import { useId, useMemo, useState, type FormEvent } from "react";
import {
	convertTransaction,
	createPosting,
	createRule,
	updatePosting,
	updateRule,
} from "@/api/generated/endpoints.ts";
import { type Transaction, visibleAccounts } from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	getServerModel,
	refreshTransactions,
	useTransactionCatalog,
} from "../../state/workspaceResources.ts";
import { useSavedAccounts, useSavedStartDate } from "../../state/savedRows.ts";
import { parseDisplayNumber } from "./formValues.ts";
import {
	combineDayTime,
	timeOfDay,
	postingBody,
	postingUpdateBody,
	ruleBody,
	ruleUpdateBody,
	validateTransactionValues,
	type TransactionFormValues,
} from "./transactionBodies.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Notice } from "../Notice.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";

/** Transaction editor. Saves straight to the server; no draft involved. */
export function TransactionEditor({
	item,
	onSaved,
	onClose,
}: {
	item: Transaction | null;
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
	const claimRules = useMemo(
		() =>
			(catalog.data?.items ?? []).filter(
				(rule) => rule.kind === "rule" && rule.id !== item?.id,
			),
		[catalog.data, item],
	);
	const [name, setName] = useState(item?.name ?? "");
	const [amount, setAmount] = useState(
		item?.amountKnown === false ? "" : String(item?.amount ?? 500),
	);
	const [amountKind, setAmountKind] = useState<"fixed" | "growth">(
		(item?.annualIncrease ?? 0) !== 0 ? "growth" : "fixed",
	);
	const [annualIncrease, setAnnualIncrease] = useState(
		String(item?.annualIncrease ?? 3),
	);
	const [frequency, setFrequency] = useState<Transaction["frequency"]>(
		item?.frequency ?? "monthly",
	);
	const [fromId, setFromId] = useState(item?.fromId ?? "");
	const [toId, setToId] = useState(item?.toId ?? "");
	const [startDate, setStartDate] = useState(item?.startDate ?? fallbackStart);
	const [noEndDate, setNoEndDate] = useState(item?.endDate == null);
	const [endDate, setEndDate] = useState(item?.endDate ?? "");
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [claimRuleId, setClaimRuleId] = useState(item?.claimRuleId ?? "");
	const [claimOccurrenceDate, setClaimOccurrenceDate] = useState(
		item?.claimOccurrenceDate ?? "",
	);
	const [saving, setSaving] = useState(false);
	const [transactionTime, setTransactionTime] = useState(
		timeOfDay(item?.transactionTime),
	);
	const [error, setError] = useState<string | null>(null);
	const enabledId = useId();
	const noEndDateId = useId();

	const isOnce = frequency === "once";
	const calculated = item !== null && item.amountKnown === false;
	const readOnly = item?.readOnly ?? false;
	const blocked = readOnly || calculated;

	const dirty =
		name !== (item?.name ?? "") ||
		amount !==
			(item?.amountKnown === false ? "" : String(item?.amount ?? 500)) ||
		amountKind !== ((item?.annualIncrease ?? 0) !== 0 ? "growth" : "fixed") ||
		annualIncrease !== String(item?.annualIncrease ?? 3) ||
		frequency !== (item?.frequency ?? "monthly") ||
		fromId !== (item?.fromId ?? "") ||
		toId !== (item?.toId ?? "") ||
		startDate !== (item?.startDate ?? fallbackStart) ||
		noEndDate !== (item?.endDate == null) ||
		endDate !== (item?.endDate ?? "") ||
		enabled !== (item?.enabled ?? true) ||
		claimRuleId !== (item?.claimRuleId ?? "") ||
		claimOccurrenceDate !== (item?.claimOccurrenceDate ?? "") ||
		transactionTime !== timeOfDay(item?.transactionTime);
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (blocked || saving) return;
		const trimmedName = name.trim();
		const parsedAmount = parseDisplayNumber(amount);
		if (parsedAmount === null) {
			setError("Enter an amount of zero or more.");
			return;
		}
		const growth =
			!isOnce && amountKind === "growth"
				? (parseDisplayNumber(annualIncrease) ?? Number.NaN)
				: 0;
		const values: TransactionFormValues = {
			name: trimmedName,
			amount: parsedAmount,
			annualIncrease: growth,
			fromId: fromId || null,
			toId: toId || null,
			frequency,
			startDate,
			endDate: !isOnce && !noEndDate && endDate ? endDate : null,
			postedDate: item?.postedDate ?? null,
			transactionTime: isOnce
				? item &&
					startDate === item.startDate &&
					transactionTime === timeOfDay(item.transactionTime)
					? item.transactionTime
					: combineDayTime(startDate, transactionTime)
				: null,
			enabled,
			claimRuleId: isOnce && claimRuleId ? claimRuleId : null,
			claimOccurrenceDate:
				isOnce && claimRuleId && claimOccurrenceDate
					? claimOccurrenceDate
					: null,
		};
		const invalid = validateTransactionValues(values);
		if (invalid) {
			setError(invalid);
			return;
		}
		if (!isOnce && amountKind === "growth" && !Number.isFinite(growth)) {
			setError("Enter a yearly increase between -50 and 50 percent.");
			return;
		}
		setSaving(true);
		setError(null);
		const wasOnce = item?.frequency === "once";
		const nowOnce = values.frequency === "once";
		// Kind changes state explicit new bodies; same-kind updates carry
		// unedited fields over from the canonical raw row.
		const raw =
			item && wasOnce === nowOnce
				? nowOnce
					? getServerModel()?.model?.postings.find((row) => row.id === item.id)
					: getServerModel()?.model?.recurrenceRules.find(
							(row) => row.id === item.id,
						)
				: undefined;
		if (item && wasOnce === nowOnce && !raw) {
			setSaving(false);
			setError(
				"The saved transaction could not be loaded. Close and try again.",
			);
			return;
		}
		const ok = item
			? await performSave({
					call: () => {
						if (wasOnce !== nowOnce)
							return convertTransaction(item.id, {
								kind: nowOnce ? "posting" : "rule",
								...(nowOnce
									? { posting: postingBody(values) }
									: { rule: ruleBody(values) }),
							});
						if (!raw)
							throw new Error("The saved transaction could not be loaded.");
						return "postedTime" in raw
							? updatePosting(
									item.id,
									postingUpdateBody({ baseline: item, raw, values }),
								)
							: updateRule(
									item.id,
									ruleUpdateBody({ baseline: item, raw, values }),
								);
					},
					refresh: refreshTransactions,
					failureMessage: "The transaction could not be saved.",
				})
			: await performSave({
					call: () =>
						values.frequency === "once"
							? createPosting({
									...postingBody(values),
									id: crypto.randomUUID(),
								})
							: createRule({ ...ruleBody(values), id: crypto.randomUUID() }),
					refresh: refreshTransactions,
					failureMessage: "The transaction could not be saved.",
				});
		setSaving(false);
		// Keep failed form values; close only after confirmed save.
		if (ok) onSaved();
		else
			setError(
				"The transaction could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<Modal
			title={`${item ? "Edit" : "Add"} planned transaction`}
			onClose={onClose}
		>
			{calculated && (
				<Notice>
					This amount is calculated each occurrence. Calculated transactions
					cannot be edited here; they stay as Varies.
				</Notice>
			)}
			{error && <ErrorNotice message={error} />}
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={blocked || saving}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
				>
					<InputField
						label="Transaction name"
						wide
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Monthly investing"
					/>
					{!isOnce && (
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
					)}
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
					{!isOnce && amountKind === "growth" && (
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
								"monthly",
								"yearly",
								"once",
							] as const);
							if (next) setFrequency(next);
						}}
					>
						<option value="monthly">Monthly</option>
						<option value="yearly">Yearly</option>
						<option value="once">One time</option>
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
						label={isOnce ? "Date" : "First occurrence"}
						type="date"
						required
						value={startDate}
						onChange={(event) => setStartDate(event.target.value)}
					/>
					{isOnce ? (
						<>
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
								value={claimRuleId}
								onChange={(event) => setClaimRuleId(event.target.value)}
							>
								<option value="">No link — standalone record</option>
								{claimRules.map((rule) => (
									<option key={rule.id} value={rule.id}>
										{rule.name}
									</option>
								))}
							</SelectField>
							<InputField
								label="Replaces occurrence on"
								type="date"
								value={claimOccurrenceDate}
								onChange={(event) => setClaimOccurrenceDate(event.target.value)}
							/>
						</>
					) : (
						<>
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
						</>
					)}
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
					<Button type="submit" disabled={blocked || saving || !dirty}>
						{saving ? "Saving…" : item ? "Save transaction" : "Add transaction"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
