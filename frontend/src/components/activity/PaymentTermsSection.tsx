import { useId, useState, type FormEvent } from "react";
import {
	deletePaymentTerms,
	savePaymentTerms,
} from "@/api/generated/endpoints.ts";
import type { PaymentTerms } from "@/api/generated/model/paymentTerms.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { useEditDraft } from "../editors/useEditDraft.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	getPaymentTermsForAccount,
	refreshPaymentTerms,
	usePaymentTerms,
} from "../../state/workspaceResources.ts";
import { Button } from "@/components/ui/button.tsx";
import { Field, FieldLabel, FieldError } from "@/components/ui/field.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group.tsx";

type TermsDraft = {
	minimumFixed: string;
	minimumPercent: string;
	dueDay: string;
	statementDay: string;
};

function draftFromTerms(saved: PaymentTerms | null): TermsDraft {
	return {
		minimumFixed: saved ? String(saved.minimumFixed) : "",
		minimumPercent:
			saved?.minimumPercent === undefined || saved.minimumPercent === null
				? ""
				: String(saved.minimumPercent * 100),
		dueDay: saved ? String(saved.dueDay) : "",
		statementDay:
			saved?.statementDay === undefined || saved.statementDay === null
				? ""
				: String(saved.statementDay),
	};
}

function parseDay(raw: string): number | null {
	const value = parseDisplayNumber(raw);
	if (value === null || !Number.isInteger(value)) return null;
	return value;
}

/**
 * Minimums and due dates for one debt account. Terms render only for debt
 * accounts and stay editable here; grouped loan accounts keep their
 * fixed payment schedules instead, so this section never renders for them.
 * Saving writes through POST /v1/payment-terms, clearing the minimum or
 * removing deletes through DELETE /v1/payment-terms/{accountId}.
 */
export function PaymentTermsSection({
	accountId,
	readOnly,
}: {
	accountId: string;
	readOnly: boolean;
}) {
	const termsQuery = usePaymentTerms();
	const saved = getPaymentTermsForAccount(accountId) ?? null;
	const edit = useEditDraft(accountId, draftFromTerms(saved));
	const draft = edit.value;
	const formId = useId();
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const locked = readOnly || saving;
	// Clearing the minimum removes existing terms; with no saved row an
	// empty minimum is a validation error, not a remove.
	const removeIntent = saved !== null && draft.minimumFixed.trim() === "";

	const update = (patch: Partial<TermsDraft>) => {
		if (locked) return;
		edit.update(patch);
		setError(null);
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (locked) return;
		if (edit.conflict) {
			setError(
				"These payment terms changed during your edit. Discard your edits before applying new changes.",
			);
			return;
		}
		const minimumFixed = parseDisplayNumber(draft.minimumFixed);
		const minimumPercent = draft.minimumPercent.trim()
			? parseDisplayNumber(draft.minimumPercent)
			: null;
		const dueDay = draft.dueDay.trim() ? parseDay(draft.dueDay) : null;
		const statementDay = draft.statementDay.trim()
			? parseDay(draft.statementDay)
			: null;
		if (removeIntent) {
			setSaving(true);
			setError(null);
			const ok = await performSave({
				call: () => deletePaymentTerms(accountId),
				refresh: refreshPaymentTerms,
				failureMessage: "The payment terms could not be removed.",
				onRejected: setError,
			});
			setSaving(false);
			if (ok) edit.reset();
			else
				setError(
					(previous) =>
						previous ??
						"The payment terms could not be removed. Review the workspace notice and try again.",
				);
			return;
		}
		if (minimumFixed === null) {
			setError("Enter a minimum payment in USD.");
			return;
		}
		if (minimumFixed < 0) {
			setError("The minimum payment cannot be negative.");
			return;
		}
		if (
			draft.minimumPercent.trim() &&
			(minimumPercent === null || minimumPercent < 0 || minimumPercent > 100)
		) {
			setError("Enter the minimum percent as a number between 0 and 100.");
			return;
		}
		if (dueDay === null || dueDay < 1 || dueDay > 28) {
			setError("Enter a due day between 1 and 28.");
			return;
		}
		if (
			draft.statementDay.trim() &&
			(statementDay === null || statementDay < 1 || statementDay > 28)
		) {
			setError("Enter a statement day between 1 and 28, or leave it empty.");
			return;
		}
		setSaving(true);
		setError(null);
		const ok = await performSave({
			call: () =>
				savePaymentTerms({
					accountId,
					minimumFixed,
					...(minimumPercent === null
						? {}
						: { minimumPercent: minimumPercent / 100 }),
					dueDay,
					...(statementDay === null ? {} : { statementDay }),
				}),
			refresh: refreshPaymentTerms,
			failureMessage: "The payment terms could not be saved.",
			onRejected: setError,
		});
		setSaving(false);
		if (ok) edit.reset();
		else
			setError(
				(previous) =>
					previous ??
					"The payment terms could not be saved. Review the workspace notice and try again.",
			);
	};

	const remove = async () => {
		if (locked || saved === null) return;
		setSaving(true);
		setError(null);
		const ok = await performSave({
			call: () => deletePaymentTerms(accountId),
			refresh: refreshPaymentTerms,
			failureMessage: "The payment terms could not be removed.",
			onRejected: setError,
		});
		setSaving(false);
		if (ok) edit.reset();
		else
			setError(
				(previous) =>
					previous ??
					"The payment terms could not be removed. Review the workspace notice and try again.",
			);
	};

	return (
		<section
			aria-label="Payment terms"
			className="grid gap-4 border-t border-border pt-4"
		>
			<div>
				<h3 className="m-0 text-sm font-semibold">Payment terms</h3>
				<p className="m-0 mt-1 text-xs leading-relaxed text-muted-foreground">
					Minimums and due dates for this account. Saving writes the terms;
					clearing the minimum removes them.
				</p>
			</div>
			{termsQuery.isPending ? (
				<p role="status" className="m-0 text-sm text-muted-foreground">
					Loading payment terms…
				</p>
			) : termsQuery.isError ? (
				<p
					role="alert"
					className="m-0 flex flex-wrap items-center gap-2 text-sm"
				>
					<span className="text-destructive">
						Payment terms could not be loaded.
					</span>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => void termsQuery.refetch()}
					>
						Retry
					</Button>
				</p>
			) : (
				<form
					id={formId}
					className="grid gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<Field orientation="horizontal">
						<FieldLabel htmlFor={`${formId}-minimum`}>Minimum</FieldLabel>
						<InputGroup className="max-w-48 flex-1">
							<InputGroupAddon aria-hidden="true">$</InputGroupAddon>
							<InputGroupInput
								id={`${formId}-minimum`}
								aria-label="Minimum payment in USD"
								name="minimumFixed"
								type="number"
								min="0"
								max="10000000000"
								step="0.01"
								value={draft.minimumFixed}
								readOnly={locked}
								onChange={(event) =>
									update({ minimumFixed: event.target.value })
								}
							/>
						</InputGroup>
					</Field>
					<Field orientation="horizontal">
						<FieldLabel htmlFor={`${formId}-percent`}>
							Minimum percent
						</FieldLabel>
						<InputGroup className="max-w-48 flex-1">
							<InputGroupInput
								id={`${formId}-percent`}
								aria-label="Minimum percent of the balance"
								name="minimumPercent"
								type="number"
								min="0"
								max="100"
								step="0.01"
								value={draft.minimumPercent}
								placeholder="None"
								readOnly={locked}
								onChange={(event) =>
									update({ minimumPercent: event.target.value })
								}
							/>
							<InputGroupAddon aria-hidden="true">%</InputGroupAddon>
						</InputGroup>
					</Field>
					<Field orientation="horizontal">
						<FieldLabel htmlFor={`${formId}-due`}>Due day</FieldLabel>
						<InputGroup className="max-w-48 flex-1">
							<InputGroupInput
								id={`${formId}-due`}
								aria-label="Due day of the month"
								name="dueDay"
								type="number"
								min="1"
								max="28"
								step="1"
								value={draft.dueDay}
								readOnly={locked}
								onChange={(event) => update({ dueDay: event.target.value })}
							/>
						</InputGroup>
					</Field>
					<Field orientation="horizontal">
						<FieldLabel htmlFor={`${formId}-statement`}>
							Statement day
						</FieldLabel>
						<InputGroup className="max-w-48 flex-1">
							<InputGroupInput
								id={`${formId}-statement`}
								aria-label="Statement day of the month, optional"
								name="statementDay"
								type="number"
								min="1"
								max="28"
								step="1"
								value={draft.statementDay}
								placeholder="None"
								readOnly={locked}
								onChange={(event) =>
									update({ statementDay: event.target.value })
								}
							/>
						</InputGroup>
					</Field>
					{error && <FieldError>{error}</FieldError>}
					{!readOnly && (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="submit"
								size="sm"
								disabled={saving || (!edit.dirty && !removeIntent)}
							>
								{saving
									? "Saving…"
									: removeIntent
										? "Remove payment terms"
										: "Save payment terms"}
							</Button>
							{saved !== null && !removeIntent && (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={saving}
									onClick={() => void remove()}
								>
									{saving ? "Removing…" : "Remove"}
								</Button>
							)}
						</div>
					)}
				</form>
			)}
		</section>
	);
}
