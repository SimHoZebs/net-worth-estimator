import { useId, useRef, useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { isoDate, todayIso } from "@/domain/format.ts";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group.tsx";

/** Raw draft values; strings keep partially typed input intact on failure. */
export interface StatementEntryDraft {
	statementClose: string;
	statementBalance: string;
	dueDate: string;
}

/** Values returned after the form validates and parses. */
export interface StatementEntryValue {
	statementClose: string;
	statementBalance: number;
	dueDate: string;
}

type FieldName = keyof StatementEntryDraft;

export function emptyStatementDraft(today = new Date()): StatementEntryDraft {
	return { statementClose: isoDate(today), statementBalance: "", dueDate: "" };
}

function validate(
	draft: StatementEntryDraft,
): Record<FieldName, string | null> {
	const errors: Record<FieldName, string | null> = {
		statementClose: null,
		statementBalance: null,
		dueDate: null,
	};
	if (!draft.statementClose)
		errors.statementClose = "Choose the statement close.";
	else if (draft.statementClose > todayIso())
		errors.statementClose = "Choose a statement close on or before today.";
	const balance = parseDisplayNumber(draft.statementBalance);
	if (balance === null || balance <= 0)
		errors.statementBalance = "Enter the statement balance in USD.";
	else if (Math.abs(balance - Math.round(balance * 100) / 100) > 1e-9)
		errors.statementBalance =
			"Enter the statement balance to the nearest cent.";
	if (!draft.dueDate) errors.dueDate = "Choose the due date.";
	else if (draft.statementClose && draft.dueDate < draft.statementClose)
		errors.dueDate = "Choose a due date on or after the statement close.";
	return errors;
}

/**
 * Entry form for one issued card statement. It is a plain section, not a
 * dialog, so it can sit inside the account details or card details surface.
 * The backend owns the statement; validation here is for feedback only and
 * success is whatever the submit callback confirms.
 */
export function StatementEntry({
	initial,
	accountLabel,
	editing = false,
	readOnly = false,
	saving = false,
	error = null,
	onSubmit,
	onCancel,
}: {
	initial?: Partial<StatementEntryDraft>;
	accountLabel?: string;
	editing?: boolean;
	readOnly?: boolean;
	saving?: boolean;
	error?: string | null;
	onSubmit: (value: StatementEntryValue) => Promise<boolean> | boolean;
	onCancel?: () => void;
}) {
	const generatedId = useId();
	const [draft, setDraft] = useState<StatementEntryDraft>(() => ({
		...emptyStatementDraft(),
		...initial,
	}));
	const [submitted, setSubmitted] = useState(false);
	const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>(
		{},
	);
	const refs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});
	const errors = validate(draft);
	const locked = readOnly || saving;
	const showError = (field: FieldName) =>
		(submitted || touched[field]) && errors[field];
	const fieldProps = (field: FieldName) => ({
		"aria-invalid": (showError(field) ? "true" : "false") as "true" | "false",
		"aria-describedby": showError(field)
			? `${generatedId}-${field}-error`
			: undefined,
		onBlur: () => setTouched((previous) => ({ ...previous, [field]: true })),
	});
	const update = (field: FieldName, value: string) =>
		setDraft((previous) => ({ ...previous, [field]: value }));

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (locked) return;
		setSubmitted(true);
		const firstInvalid = (Object.keys(errors) as FieldName[]).find(
			(field) => errors[field],
		);
		if (firstInvalid) {
			refs.current[firstInvalid]?.focus();
			return;
		}
		const ok = await onSubmit({
			statementClose: draft.statementClose,
			statementBalance: parseDisplayNumber(draft.statementBalance) ?? 0,
			dueDate: draft.dueDate,
		});
		if (ok) {
			setSubmitted(false);
			setTouched({});
		}
	};

	return (
		<form
			aria-labelledby={`${generatedId}-heading`}
			noValidate
			onSubmit={(event) => void submit(event)}
			className="grid gap-4"
		>
			<h3 id={`${generatedId}-heading`} className="m-0 text-base font-semibold">
				{editing
					? "Edit statement"
					: accountLabel
						? `Add a statement for ${accountLabel}`
						: "Add a card statement"}
			</h3>
			<Alert>
				<Info size={15} aria-hidden="true" />
				<AlertDescription>
					Enter what the issuer billed. The configured closing day helps
					forecast future closes; a current balance or an estimate from imported
					activity is not the statement balance.
				</AlertDescription>
			</Alert>

			<Field>
				<FieldLabel htmlFor={`${generatedId}-close`}>
					Statement close
				</FieldLabel>
				<Input
					id={`${generatedId}-close`}
					name="statementClose"
					type="date"
					max={todayIso()}
					required
					disabled={locked}
					ref={(node) => {
						refs.current.statementClose = node;
					}}
					value={draft.statementClose}
					onChange={(event) => update("statementClose", event.target.value)}
					{...fieldProps("statementClose")}
				/>
				<FieldError id={`${generatedId}-statementClose-error`}>
					{showError("statementClose") ?? ""}
				</FieldError>
			</Field>

			<Field>
				<FieldLabel htmlFor={`${generatedId}-balance`}>
					Statement balance
				</FieldLabel>
				<InputGroup>
					<InputGroupAddon aria-hidden="true">$</InputGroupAddon>
					<InputGroupInput
						id={`${generatedId}-balance`}
						name="statementBalance"
						type="number"
						inputMode="decimal"
						min={0.01}
						max={10000000000}
						step={0.01}
						required
						disabled={locked}
						ref={(node) => {
							refs.current.statementBalance = node;
						}}
						value={draft.statementBalance}
						onChange={(event) => update("statementBalance", event.target.value)}
						{...fieldProps("statementBalance")}
					/>
				</InputGroup>
				<FieldDescription>
					The billed amount for this statement, not the running card balance.
				</FieldDescription>
				<FieldError id={`${generatedId}-statementBalance-error`}>
					{showError("statementBalance") ?? ""}
				</FieldError>
			</Field>

			<Field>
				<FieldLabel htmlFor={`${generatedId}-due`}>Due date</FieldLabel>
				<Input
					id={`${generatedId}-due`}
					name="dueDate"
					type="date"
					min={draft.statementClose || undefined}
					required
					disabled={locked}
					ref={(node) => {
						refs.current.dueDate = node;
					}}
					value={draft.dueDate}
					onChange={(event) => update("dueDate", event.target.value)}
					{...fieldProps("dueDate")}
				/>
				<FieldError id={`${generatedId}-dueDate-error`}>
					{showError("dueDate") ?? ""}
				</FieldError>
			</Field>

			<FieldError>{error ?? ""}</FieldError>

			<div className="flex flex-wrap items-center gap-2">
				<Button type="submit" variant="default" disabled={locked}>
					{saving ? "Saving…" : "Save statement"}
				</Button>
				{onCancel && (
					<Button
						type="button"
						variant="ghost"
						disabled={saving}
						onClick={onCancel}
					>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
