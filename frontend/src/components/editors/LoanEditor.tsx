import { useEffect, useId, useState, type FormEvent } from "react";
import { createLoan, updateLoan } from "@/api/generated/endpoints.ts";
import type { Account } from "../../domain/model.ts";
import { literalAmountOf } from "../../domain/transactionRows.ts";
import { exactMoney } from "../../domain/format.ts";
import { useSavedAccounts } from "../../state/savedState.ts";
import {
	refreshAccounts,
	refreshTransactions,
	useSchedules,
} from "../../state/workspaceResources.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { EditorField, EditorSelect, MoneyField } from "./editorFields.tsx";
import { AccountIcon } from "../AccountIcon.tsx";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";
import { isLiability } from "../../domain/accountKinds.ts";

const frequencies = [
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"annual",
] as const;
type Frequency = (typeof frequencies)[number];

/** Loan-term frequency implied by a linked schedule's recurrence. Loan
 * charges and payments are monthly in practice; anything else falls back
 * to monthly rather than blocking the editor. */
function loanFrequencyOf(schedule?: {
	recurrence?: { unit?: string; interval?: number } | null;
}): Frequency {
	const unit = schedule?.recurrence?.unit;
	const interval = schedule?.recurrence?.interval;
	if (unit === "day" && interval === 1) return "daily";
	if (unit === "week" && interval === 1) return "weekly";
	if (unit === "month" && interval === 3) return "quarterly";
	if (unit === "year" && interval === 1) return "annual";
	return "monthly";
}

const frequencyOptions = frequencies.map((frequency) => ({
	value: frequency,
	label: frequency,
}));

type LoanEditorProps = {
	item: Account | null;
	onSaved: () => void;
	formId: string;
	name: string;
	enabled: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	onSavingChange: (saving: boolean) => void;
	onSaveDisabledChange?: (disabled: boolean) => void;
};

export function LoanEditor(props: LoanEditorProps) {
	const { item, onSaveDisabledChange } = props;
	const schedules = useSchedules();
	const accounts = useSavedAccounts();
	const waiting =
		!accounts || (item && (schedules.isPending || schedules.isError));
	// No form exists while terms load, so the shared footer cannot submit.
	useEffect(() => {
		if (waiting) onSaveDisabledChange?.(true);
	}, [waiting, onSaveDisabledChange]);
	if (!accounts || (item && schedules.isPending))
		return <p role="status">Loading loan terms…</p>;
	if (item && schedules.isError)
		return (
			<Alert variant="destructive">
				<AlertDescription>Loan terms could not be loaded.</AlertDescription>
			</Alert>
		);
	return (
		<LoanForm
			{...props}
			accounts={accounts}
			schedules={schedules.data?.schedules ?? []}
		/>
	);
}

function LoanForm({
	item,
	accounts,
	schedules,
	onSaved,
	formId,
	name,
	enabled,
	onDirtyChange,
	onSavingChange,
	onSaveDisabledChange,
}: LoanEditorProps & {
	accounts: Account[];
	schedules: NonNullable<ReturnType<typeof useSchedules>["data"]>["schedules"];
}) {
	const charge = schedules.find(
		(s) => s.id === item?.display?.interestScheduleId,
	);
	const paymentRule = schedules.find(
		(s) => s.id === item?.display?.paymentScheduleId,
	);
	const rateBinding = Object.values(charge?.amount.inputs ?? {}).find(
		(b) => b.provider === "occurrence-rate",
	);
	const rateArguments = rateBinding?.arguments as
		| Record<string, unknown>
		| undefined;
	const plain = !!item && !isGroupedDisplay(item);
	const principal = Math.abs(
		item?.components?.find((c) => c.role === "principal")?.balance ??
			(plain ? (item?.balance ?? 0) : 0),
	);
	const interest = Math.abs(
		item?.components?.find((c) => c.role === "interest")?.balance ?? 0,
	);
	const [today] = useState(() => new Date().toISOString().slice(0, 10));
	const initial = {
		principal: String(Number(principal.toFixed(2))),
		interest: String(Number(interest.toFixed(2))),
		rate: String(
			typeof rateArguments?.annualRate === "number"
				? Number((rateArguments.annualRate * 100).toFixed(4))
				: item && !plain
					? ""
					: 0,
		),
		payment: String(
			paymentRule
				? (literalAmountOf(paymentRule.amount) ?? "")
				: item && !plain
					? ""
					: 0,
		),
		funding:
			paymentRule?.sourceAccountId ??
			accounts.find((a) => a.id !== item?.id && !isLiability(a) && !a.archived)
				?.id ??
			"",
		interestFrequency: loanFrequencyOf(charge),
		paymentFrequency: loanFrequencyOf(paymentRule),
		interestStart: charge?.startDate ?? today,
		paymentStart: paymentRule?.startDate ?? today,
	};
	const [baseline] = useState(initial);
	const [values, setValues] = useState(initial);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const principalId = useId();
	const interestId = useId();
	const rateId = useId();
	const paymentId = useId();
	const fundingId = useId();
	const interestFrequencyId = useId();
	const paymentFrequencyId = useId();
	const interestStartId = useId();
	const paymentStartId = useId();
	const ownDirty = JSON.stringify(values) !== JSON.stringify(baseline);
	useEffect(() => {
		onDirtyChange?.(ownDirty);
	}, [ownDirty, onDirtyChange]);
	const locked = saving || item?.readOnly;
	useEffect(() => {
		onSaveDisabledChange?.(Boolean(locked));
	}, [locked, onSaveDisabledChange]);
	const change = <K extends keyof typeof values>(
		key: K,
		value: (typeof values)[K],
	) => {
		setValues((old) => ({ ...old, [key]: value }));
		setError(null);
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving || item?.readOnly) return;
		if (isGroupedDisplay(item) && (!charge || !paymentRule)) {
			setError("The loan's account rules are missing.");
			return;
		}
		setSaving(true);
		onSavingChange(true);
		setError(null);
		const body = {
			name: name.trim(),
			principal: Number(values.principal),
			accruedInterest: Number(values.interest),
			annualRate:
				values.rate === baseline.rate &&
				typeof rateArguments?.annualRate === "number"
					? rateArguments.annualRate
					: Number(values.rate) / 100,
			payment: Number(values.payment),
			fundingAccountId: values.funding,
			interestFrequency: values.interestFrequency,
			paymentFrequency: values.paymentFrequency,
			interestStartDate: values.interestStart,
			paymentStartDate: values.paymentStart,
			enabled,
			observedAt: Math.floor(Date.now() / 1000),
			recordBalances:
				!item ||
				values.principal !== baseline.principal ||
				values.interest !== baseline.interest,
		};
		const ok = await performSave({
			call: () => (item ? updateLoan(item.id, body) : createLoan(body)),
			refresh: async () => {
				await refreshAccounts();
				await refreshTransactions();
			},
			failureMessage: "The loan could not be saved.",
		});
		setSaving(false);
		onSavingChange(false);
		if (ok) onSaved();
		else
			setError(
				"The loan could not be saved. Your entries are preserved. Review the workspace notice and try again.",
			);
	};
	return (
		<form
			id={formId}
			className="flex flex-col gap-5"
			onSubmit={(event) => void submit(event)}
		>
			<fieldset
				disabled={locked}
				className="m-0 flex flex-col gap-5 border-0 p-0"
			>
				<legend className="sr-only">Loan terms</legend>
				<FieldSet className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
					<FieldLegend>Amount owed</FieldLegend>
					<MoneyField
						id={principalId}
						label="Principal"
						name="principal"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={values.principal}
						onChange={(e) => change("principal", e.target.value)}
						disabled={locked}
					/>
					<MoneyField
						id={interestId}
						label="Accrued interest"
						name="interest"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={values.interest}
						onChange={(e) => change("interest", e.target.value)}
						disabled={locked}
					/>
					<p className="col-span-full m-0 flex justify-between text-sm text-muted-foreground">
						Total owed{" "}
						<strong className="type-value text-foreground">
							{exactMoney(Number(values.principal) + Number(values.interest))}
						</strong>
					</p>
				</FieldSet>
				<fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0 max-sm:grid-cols-1">
					<FieldLegend variant="label">Interest</FieldLegend>
					<EditorField label="Annual interest rate (%)" htmlFor={rateId}>
						<Input
							id={rateId}
							name="rate"
							type="number"
							required
							min="0"
							max="100"
							step="0.0001"
							value={values.rate}
							onChange={(e) => change("rate", e.target.value)}
							disabled={locked}
						/>
					</EditorField>
					<EditorField
						label="Interest charge frequency"
						htmlFor={interestFrequencyId}
					>
						<EditorSelect
							id={interestFrequencyId}
							value={values.interestFrequency}
							onValueChange={(next) =>
								change("interestFrequency", next as Frequency)
							}
							options={frequencyOptions}
							disabled={locked}
						/>
					</EditorField>
					<EditorField label="First interest charge" htmlFor={interestStartId}>
						<Input
							id={interestStartId}
							name="interestStart"
							type="date"
							required
							value={values.interestStart}
							onChange={(e) => change("interestStart", e.target.value)}
							disabled={locked}
						/>
					</EditorField>
				</fieldset>
				<fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0 max-sm:grid-cols-1">
					<FieldLegend variant="label">Payments</FieldLegend>
					<MoneyField
						id={paymentId}
						label="Payment amount"
						name="payment"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={values.payment}
						onChange={(e) => change("payment", e.target.value)}
						disabled={locked}
					/>
					<EditorField label="Pay from" htmlFor={fundingId}>
						<EditorSelect
							id={fundingId}
							value={values.funding}
							onValueChange={(next) => change("funding", next)}
							emptyLabel="Select funding account"
							options={accounts
								.filter(
									(a) => a.id !== item?.id && !isLiability(a) && !a.archived,
								)
								.map((a) => ({
									value: a.id,
									label: a.name,
									icon: (
										<AccountIcon account={a} size="sm" className="size-6" />
									),
								}))}
							disabled={locked}
						/>
					</EditorField>
					<EditorField label="Payment frequency" htmlFor={paymentFrequencyId}>
						<EditorSelect
							id={paymentFrequencyId}
							value={values.paymentFrequency}
							onValueChange={(next) =>
								change("paymentFrequency", next as Frequency)
							}
							options={frequencyOptions}
							disabled={locked}
						/>
					</EditorField>
					<EditorField label="First payment" htmlFor={paymentStartId}>
						<Input
							id={paymentStartId}
							name="paymentStart"
							type="date"
							required
							value={values.paymentStart}
							onChange={(e) => change("paymentStart", e.target.value)}
							disabled={locked}
						/>
					</EditorField>
				</fieldset>
			</fieldset>
			{error ? <FieldError>{error}</FieldError> : null}
		</form>
	);
}
