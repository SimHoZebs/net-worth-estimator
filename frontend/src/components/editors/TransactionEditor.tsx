import { useId, useMemo, useState, type FormEvent } from "react";
import {
	convertTransaction,
	createPosting,
	createRule,
	updatePosting,
	updateRule,
} from "@/api/generated/endpoints.ts";
import type { PostingAmountResolution } from "@/api/generated/model/postingAmountResolution.ts";
import type { PostingBody } from "@/api/generated/model/postingBody.ts";
import type { RuleBody } from "@/api/generated/model/ruleBody.ts";
import {
	type Transaction,
	type Plan,
	visibleAccounts,
} from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { refreshTransactions } from "../../state/workspaceResources.ts";
import { usePlan } from "../../state/useWorkspacePlan.ts";
import { useTransactionCatalog } from "../../state/workspaceResources.ts";
import { parseDisplayNumber, textValue, numberValue } from "./formValues.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Notice } from "../Notice.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";
import { sourceReadOnlyReason } from "./EditorForm.tsx";

export interface TransactionFormValues {
	name: string;
	amount: number;
	annualIncrease: number;
	fromId: string | null;
	toId: string | null;
	frequency: Transaction["frequency"];
	startDate: string;
	endDate: string | null;
	postedDate: string | null;
	enabled: boolean;
	claimRuleId: string | null;
	claimOccurrenceDate: string | null;
}

function midnightOfDay(day: string): number {
	return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

/**
 * Literal amount descriptor. A non-zero annual increase rides as a
 * growth-factor provider input, the same shape the adapter reads and writes,
 * so rules round-trip without dedicated backend columns.
 */
function transactionAmountDescriptor(
	amount: number,
	annualIncrease: number,
): PostingAmountResolution {
	const expression = String(amount);
	if (!annualIncrease)
		return { resolver: "expression", config: { expression }, inputs: {} };
	return {
		resolver: "expression",
		config: { expression: `(${expression}) * growth` },
		inputs: {
			growth: {
				source: "provider",
				provider: "growth-factor",
				arguments: { annualGrowthRate: annualIncrease / 100 },
			},
		},
	};
}

function postingBody(values: TransactionFormValues): PostingBody {
	return {
		name: values.name,
		amount: transactionAmountDescriptor(values.amount, 0),
		enabled: values.enabled,
		...(values.fromId ? { sourceAccountId: values.fromId } : {}),
		destinations: values.toId ? [values.toId] : null,
		postedTime: midnightOfDay(values.postedDate ?? values.startDate),
		transactionTime: midnightOfDay(values.startDate),
		// Pending is server-owned bank metadata and is never authored here.
		...(values.claimRuleId && values.claimOccurrenceDate
			? {
					claim: {
						ruleId: values.claimRuleId,
						occurrenceDate: values.claimOccurrenceDate,
					},
				}
			: {}),
	};
}

function ruleBody(values: TransactionFormValues): RuleBody {
	return {
		name: values.name,
		amount: transactionAmountDescriptor(values.amount, values.annualIncrease),
		enabled: values.enabled,
		frequency: values.frequency === "yearly" ? "annual" : "monthly",
		startDate: values.startDate,
		...(values.endDate ? { endDate: values.endDate } : {}),
		...(values.fromId ? { sourceAccountId: values.fromId } : {}),
		destinations: values.toId ? [values.toId] : null,
	};
}

/** Pure plan builder shared by the inline detail edits. */
export function buildTransactionPlan({
	plan,
	item,
	data,
}: {
	plan: Plan;
	item: Transaction | null;
	data: FormData;
}): Plan {
	const claimRuleId = textValue(data, "claimRuleId") || null;
	const claimOccurrenceDate = textValue(data, "claimOccurrenceDate") || null;
	const amountKind = textValue(data, "amountKind") || "fixed";
	const advanced = amountKind !== "fixed" && amountKind !== "growth";
	const transaction: Transaction = {
		id: item?.id ?? crypto.randomUUID(),
		name: textValue(data, "name"),
		amount: advanced ? 0 : numberValue(data, "amount"),
		amountKnown: !advanced,
		fromId: textValue(data, "fromId") || null,
		toId: textValue(data, "toId") || null,
		frequency:
			parseUnion(textValue(data, "frequency"), [
				"monthly",
				"yearly",
				"once",
			] as const) ?? "monthly",
		startDate: textValue(data, "startDate"),
		endDate:
			textValue(data, "noEndDate") === "on"
				? null
				: textValue(data, "endDate") || null,
		annualIncrease: advanced ? 0 : numberValue(data, "annualIncrease"),
		enabled: textValue(data, "enabled") === "on",
		readOnly: false,
		claimRuleId,
		claimOccurrenceDate,
		postedDate: (textValue(data, "postedDate") || item?.postedDate) ?? null,
		void: item?.void ?? false,
	};
	return {
		...plan,
		transactions: upsertItem({ items: plan.transactions, item: transaction }),
	};
}

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
	const plan = usePlan();
	const catalog = useTransactionCatalog();
	const accounts = useMemo(() => visibleAccounts(plan?.accounts ?? []), [plan]);
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
	const [startDate, setStartDate] = useState(
		item?.startDate ?? plan?.startDate ?? todayIso(),
	);
	const [noEndDate, setNoEndDate] = useState(item?.endDate == null);
	const [endDate, setEndDate] = useState(item?.endDate ?? "");
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [claimRuleId, setClaimRuleId] = useState(item?.claimRuleId ?? "");
	const [claimOccurrenceDate, setClaimOccurrenceDate] = useState(
		item?.claimOccurrenceDate ?? "",
	);
	const [saving, setSaving] = useState(false);
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
		startDate !== (item?.startDate ?? plan?.startDate ?? todayIso()) ||
		noEndDate !== (item?.endDate == null) ||
		endDate !== (item?.endDate ?? "") ||
		enabled !== (item?.enabled ?? true) ||
		claimRuleId !== (item?.claimRuleId ?? "") ||
		claimOccurrenceDate !== (item?.claimOccurrenceDate ?? "");
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (blocked || saving) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Give the transaction a name.");
			return;
		}
		const parsedAmount = parseDisplayNumber(amount);
		if (parsedAmount === null || parsedAmount < 0 || parsedAmount > 1e10) {
			setError("Enter an amount of zero or more.");
			return;
		}
		if (!fromId && !toId) {
			setError("Choose a source or destination account.");
			return;
		}
		if (!startDate) {
			setError("Choose a date.");
			return;
		}
		const growth =
			!isOnce && amountKind === "growth"
				? (parseDisplayNumber(annualIncrease) ?? Number.NaN)
				: 0;
		if (!Number.isFinite(growth) || growth < -50 || growth > 50) {
			setError("Enter a yearly increase between -50 and 50 percent.");
			return;
		}
		if (!isOnce && !noEndDate && endDate && endDate < startDate) {
			setError("The last occurrence cannot come before the first one.");
			return;
		}
		setSaving(true);
		setError(null);
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
			enabled,
			claimRuleId: isOnce && claimRuleId ? claimRuleId : null,
			claimOccurrenceDate:
				isOnce && claimRuleId && claimOccurrenceDate
					? claimOccurrenceDate
					: null,
		};
		const ok = item
			? await performSave({
					call: () => {
						const wasOnce = item.frequency === "once";
						const isOnce = values.frequency === "once";
						if (wasOnce !== isOnce)
							return convertTransaction(item.id, {
								kind: isOnce ? "posting" : "rule",
								...(isOnce
									? { posting: postingBody(values) }
									: { rule: ruleBody(values) }),
							});
						return isOnce
							? updatePosting(item.id, postingBody(values))
							: updateRule(item.id, ruleBody(values));
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
			{readOnly && <Notice>{sourceReadOnlyReason}</Notice>}
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
						{accounts
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
						{accounts.map((account) => (
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
