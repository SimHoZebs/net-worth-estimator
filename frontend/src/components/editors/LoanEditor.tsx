import { useState, type FormEvent } from "react";
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
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { AccountIcon } from "../AccountIcon.tsx";

const frequencies = [
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"annual",
] as const;
type Frequency = (typeof frequencies)[number];

type LoanEditorProps = {
	item: Account | null;
	onClose: () => void;
	onSaved: () => void;
	formId: string;
	name: string;
	enabled: boolean;
	onSavingChange: (saving: boolean) => void;
};

export function LoanEditor(props: LoanEditorProps) {
	const { item } = props;
	const schedules = useSchedules();
	const accounts = useSavedAccounts();
	if (!accounts || (item && schedules.isPending))
		return <p role="status">Loading loan terms…</p>;
	if (item && schedules.isError)
		return <ErrorNotice message="Loan terms could not be loaded." />;
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
	onClose,
	onSaved,
	formId,
	name,
	enabled,
	onSavingChange,
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
	const principal = Math.abs(
		item?.components?.find((c) => c.role === "principal")?.balance ?? 0,
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
				: item
					? ""
					: 0,
		),
		payment: String(
			paymentRule ? (literalAmountOf(paymentRule.amount) ?? "") : item ? "" : 0,
		),
		funding:
			paymentRule?.sourceAccountId ??
			accounts.find((a) => a.kind === "cash" && !a.archived)?.id ??
			"",
		interestFrequency: (charge?.frequency ?? "monthly") as Frequency,
		paymentFrequency: (paymentRule?.frequency ?? "monthly") as Frequency,
		interestStart: charge?.startDate ?? today,
		paymentStart: paymentRule?.startDate ?? today,
	};
	const [baseline] = useState(initial);
	const [values, setValues] = useState(initial);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
	useBeforeUnload(dirty && !saving);
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
		if (item && (!charge || !paymentRule)) {
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
				disabled={saving || item?.readOnly}
				className="m-0 flex flex-col gap-5 border-0 p-0"
			>
				<legend className="sr-only">Loan terms</legend>
				<fieldset className="m-0 grid grid-cols-2 gap-4 rounded-control border border-line p-4 max-sm:grid-cols-1">
					<legend className="px-2 text-sm font-semibold">Amount owed</legend>
					<InputField
						label="Principal (USD)"
						name="principal"
						type="number"
						inputMode="decimal"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={values.principal}
						onChange={(e) => change("principal", e.target.value)}
					/>
					<InputField
						label="Accrued interest (USD)"
						name="interest"
						type="number"
						inputMode="decimal"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={values.interest}
						onChange={(e) => change("interest", e.target.value)}
					/>
					<p className="col-span-full m-0 flex justify-between text-sm text-muted">
						Total owed{" "}
						<strong className="type-value text-ink">
							{exactMoney(Number(values.principal) + Number(values.interest))}
						</strong>
					</p>
				</fieldset>
				<fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0 max-sm:grid-cols-1">
					<legend className="mb-3 text-sm font-semibold">Interest</legend>
					<InputField
						label="Annual interest rate (%)"
						name="rate"
						type="number"
						required
						min="0"
						max="100"
						step="0.0001"
						value={values.rate}
						onChange={(e) => change("rate", e.target.value)}
					/>
					<SelectField
						label="Interest charge frequency"
						name="interestFrequency"
						value={values.interestFrequency}
						onChange={(e) =>
							change("interestFrequency", e.target.value as Frequency)
						}
					>
						{frequencies.map((f) => (
							<option key={f} value={f}>
								{f}
							</option>
						))}
					</SelectField>
					<InputField
						label="First interest charge"
						name="interestStart"
						type="date"
						required
						value={values.interestStart}
						onChange={(e) => change("interestStart", e.target.value)}
					/>
				</fieldset>
				<fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0 max-sm:grid-cols-1">
					<legend className="mb-3 text-sm font-semibold">Payments</legend>
					<InputField
						label="Payment amount (USD)"
						name="payment"
						type="number"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={values.payment}
						onChange={(e) => change("payment", e.target.value)}
					/>
					<SelectField
						label="Pay from"
						rich
						name="funding"
						required
						value={values.funding}
						onChange={(e) => change("funding", e.target.value)}
					>
						<option value="">Select funding account</option>
						{accounts
							.filter(
								(a) => a.id !== item?.id && a.kind !== "debt" && !a.archived,
							)
							.map((a) => (
								<option key={a.id} value={a.id} aria-label={a.name}>
									<AccountIcon account={a} size="sm" className="size-6" />
									<span>{a.name}</span>
								</option>
							))}
					</SelectField>
					<SelectField
						label="Payment frequency"
						name="paymentFrequency"
						value={values.paymentFrequency}
						onChange={(e) =>
							change("paymentFrequency", e.target.value as Frequency)
						}
					>
						{frequencies.map((f) => (
							<option key={f} value={f}>
								{f}
							</option>
						))}
					</SelectField>
					<InputField
						label="First payment"
						name="paymentStart"
						type="date"
						required
						value={values.paymentStart}
						onChange={(e) => change("paymentStart", e.target.value)}
					/>
				</fieldset>
			</fieldset>
			<ErrorNotice message={error} />
			<div className={dialogActionsStyles}>
				<Button type="button" variant="secondary" onClick={onClose}>
					Cancel
				</Button>
				<Button type="submit" disabled={saving || item?.readOnly}>
					{saving ? "Saving…" : item ? "Save account" : "Add account"}
				</Button>
			</div>
		</form>
	);
}
