import { createElement, useId, useState, type FormEvent } from "react";
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
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { cn } from "@/lib/utils.ts";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";
import { AccountIcon } from "../AccountIcon.tsx";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";

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
			accounts.find(
				(a) => a.id !== item?.id && a.kind !== "debt" && !a.archived,
			)?.id ??
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
	const principalId = useId();
	const interestId = useId();
	const rateId = useId();
	const paymentId = useId();
	const fundingId = useId();
	const interestFrequencyId = useId();
	const paymentFrequencyId = useId();
	const interestStartId = useId();
	const paymentStartId = useId();
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
				disabled={saving || item?.readOnly}
				className="m-0 flex flex-col gap-5 border-0 p-0"
			>
				<legend className="sr-only">Loan terms</legend>
				<fieldset className="m-0 grid grid-cols-2 gap-4 rounded-control border border-line p-4 max-sm:grid-cols-1">
					<legend className="px-2 text-sm font-semibold">Amount owed</legend>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={principalId} className={fieldLabelClassName}>
							Principal (USD)
						</Label>
						<Input
							id={principalId}
							name="principal"
							type="number"
							inputMode="decimal"
							required
							min="0"
							max="10000000000"
							step="0.01"
							value={values.principal}
							onChange={(e) => change("principal", e.target.value)}
							className={fieldInputClassName}
						/>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={interestId} className={fieldLabelClassName}>
							Accrued interest (USD)
						</Label>
						<Input
							id={interestId}
							name="interest"
							type="number"
							inputMode="decimal"
							required
							min="0"
							max="10000000000"
							step="0.01"
							value={values.interest}
							onChange={(e) => change("interest", e.target.value)}
							className={fieldInputClassName}
						/>
					</Field>
					<p className="col-span-full m-0 flex justify-between text-sm text-muted">
						Total owed{" "}
						<strong className="type-value text-ink">
							{exactMoney(Number(values.principal) + Number(values.interest))}
						</strong>
					</p>
				</fieldset>
				<fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0 max-sm:grid-cols-1">
					<legend className="mb-3 text-sm font-semibold">Interest</legend>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={rateId} className={fieldLabelClassName}>
							Annual interest rate (%)
						</Label>
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
							className={fieldInputClassName}
						/>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label
							htmlFor={interestFrequencyId}
							className={fieldLabelClassName}
						>
							Interest charge frequency
						</Label>
						<select
							id={interestFrequencyId}
							name="interestFrequency"
							value={values.interestFrequency}
							onChange={(e) =>
								change("interestFrequency", e.target.value as Frequency)
							}
							className={fieldSelectClassName}
						>
							{frequencies.map((f) => (
								<option key={f} value={f}>
									{f}
								</option>
							))}
						</select>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={interestStartId} className={fieldLabelClassName}>
							First interest charge
						</Label>
						<Input
							id={interestStartId}
							name="interestStart"
							type="date"
							required
							value={values.interestStart}
							onChange={(e) => change("interestStart", e.target.value)}
							className={fieldInputClassName}
						/>
					</Field>
				</fieldset>
				<fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0 max-sm:grid-cols-1">
					<legend className="mb-3 text-sm font-semibold">Payments</legend>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={paymentId} className={fieldLabelClassName}>
							Payment amount (USD)
						</Label>
						<Input
							id={paymentId}
							name="payment"
							type="number"
							required
							min="0"
							max="10000000000"
							step="0.01"
							value={values.payment}
							onChange={(e) => change("payment", e.target.value)}
							className={fieldInputClassName}
						/>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={fundingId} className={fieldLabelClassName}>
							Pay from
						</Label>
						<select
							id={fundingId}
							name="funding"
							value={values.funding}
							onChange={(e) => change("funding", e.target.value)}
							className={cn(
								fieldSelectClassName,
								"supports-[appearance:base-select]:[appearance:base-select] supports-[appearance:base-select]:[&::picker(select)]:[appearance:base-select] [&::picker(select)]:rounded-control [&::picker(select)]:border [&::picker(select)]:border-line-strong [&::picker(select)]:bg-surface [&::picker(select)]:p-1 [&::picker(select)]:text-ink [&_option]:flex [&_option]:items-center [&_option]:gap-3 [&_option]:rounded-control [&_option]:p-2 [&_option:checked]:bg-surface-3 [&_option:checked]:font-semibold [&_option:hover]:bg-surface-3 [&_selectedcontent]:flex [&_selectedcontent]:items-center [&_selectedcontent]:gap-3",
							)}
						>
							<button type="button" className="min-w-0">
								{createElement("selectedcontent")}
							</button>
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
						</select>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={paymentFrequencyId} className={fieldLabelClassName}>
							Payment frequency
						</Label>
						<select
							id={paymentFrequencyId}
							name="paymentFrequency"
							value={values.paymentFrequency}
							onChange={(e) =>
								change("paymentFrequency", e.target.value as Frequency)
							}
							className={fieldSelectClassName}
						>
							{frequencies.map((f) => (
								<option key={f} value={f}>
									{f}
								</option>
							))}
						</select>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={paymentStartId} className={fieldLabelClassName}>
							First payment
						</Label>
						<Input
							id={paymentStartId}
							name="paymentStart"
							type="date"
							required
							value={values.paymentStart}
							onChange={(e) => change("paymentStart", e.target.value)}
							className={fieldInputClassName}
						/>
					</Field>
				</fieldset>
			</fieldset>
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
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
					disabled={saving || item?.readOnly}
				>
					{saving ? "Saving…" : item ? "Save account" : "Add account"}
				</Button>
			</div>
		</form>
	);
}
