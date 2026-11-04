import { useId, useMemo, useState, type FormEvent } from "react";
import { createPosting, createRule } from "@/api/generated/endpoints.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { dateLabel, todayIso } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshTransactions,
	useServerModel,
	useTransactionCatalog,
} from "../../state/workspaceResources.ts";
import { claimOccurrenceCandidates } from "../../domain/ruleSchedule.ts";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "../../state/savedRows.ts";
import { parseDisplayNumber } from "./formValues.ts";
import {
	combineDayTime,
	postingBody,
	ruleBody,
	validateTransactionValues,
	type FrequencyChoice,
	type TransactionFormValues,
} from "./transactionBodies.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";

/**
 * Create-only transaction form. Existing rows edit through the shared
 * TransactionDetail so there is one implementation of row editing.
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
	const claimRules = useMemo(
		() => (catalog.data?.items ?? []).filter((rule) => rule.kind === "rule"),
		[catalog.data],
	);
	// The create form picks from the same scheduled occurrence list as the
	// detail editor: closest to the new posting's own day first.
	const savedTransactions = useSavedTransactions();
	const [name, setName] = useState("");
	const [amount, setAmount] = useState("500");
	const [amountKind, setAmountKind] = useState<"fixed" | "growth">("fixed");
	const [annualIncrease, setAnnualIncrease] = useState("3");
	const [frequency, setFrequency] = useState<FrequencyChoice>("monthly");
	const [fromId, setFromId] = useState("");
	const [toId, setToId] = useState("");
	const [startDate, setStartDate] = useState(fallbackStart);
	const [noEndDate, setNoEndDate] = useState(true);
	const [endDate, setEndDate] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [claimRuleId, setClaimRuleId] = useState("");
	const [claimOccurrenceDate, setClaimOccurrenceDate] = useState("");
	const serverModel = useServerModel().data?.model;
	const occurrenceOptions = useMemo(() => {
		const rule = serverModel?.recurrenceRules.find(
			(row) => row.id === claimRuleId,
		);
		if (!rule) return [];
		const claimed = new Set<string>();
		for (const row of savedTransactions ?? []) {
			if (row.claimRuleId === claimRuleId && row.claimOccurrenceDate)
				claimed.add(row.claimOccurrenceDate);
		}
		if (claimOccurrenceDate) claimed.delete(claimOccurrenceDate);
		const candidates = claimOccurrenceCandidates({
			rule,
			through: todayIso(),
			postedRef: startDate,
			claimed,
		});
		return claimOccurrenceDate && !candidates.includes(claimOccurrenceDate)
			? [claimOccurrenceDate, ...candidates]
			: candidates;
	}, [
		serverModel,
		claimRuleId,
		startDate,
		claimOccurrenceDate,
		savedTransactions,
	]);
	const [saving, setSaving] = useState(false);
	const [transactionTime, setTransactionTime] = useState("");
	const [error, setError] = useState<string | null>(null);
	const enabledId = useId();
	const noEndDateId = useId();

	const isOnce = frequency === "once";
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
		!enabled ||
		claimRuleId !== "" ||
		claimOccurrenceDate !== "" ||
		transactionTime !== "";
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
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
			postedDate: null,
			transactionTime: isOnce
				? combineDayTime(startDate, transactionTime)
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
		const ok = await performSave({
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
		if (ok) onSaved();
		else
			setError(
				"The transaction could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<Modal title="Add planned transaction" onClose={onClose}>
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
							<SelectField
								label="Replaces occurrence on"
								value={claimOccurrenceDate}
								onChange={(event) =>
									setClaimOccurrenceDate(event.target.value)
								}
								disabled={!claimRuleId}
							>
								<option value="">
									{!claimRuleId
										? "Choose a rule first"
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
					<Button type="submit" disabled={saving || !dirty}>
						{saving ? "Saving…" : "Add transaction"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
