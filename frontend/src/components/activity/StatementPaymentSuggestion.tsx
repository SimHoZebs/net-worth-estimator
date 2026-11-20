import { useRef, useState } from "react";
import { CreditCard, Info } from "lucide-react";
import { dateLabel, exactMoney } from "@/domain/format.ts";
import {
	maxApplyAmount,
	statementStatusLabel,
	validateApplyAmount,
	type StatementPaymentSuggestion as StatementSuggestion,
} from "@/domain/statementPayment.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Field, FieldError, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";

export interface StatementPaymentSuggestionProps {
	suggestion: StatementSuggestion;
	position: number;
	total: number;
	readOnly: boolean;
	/** Parent-owned pending state, for example a refresh after an apply. */
	busy?: boolean;
	error: string | null;
	/** Apply `amount` to `statementId`; resolve true on success. */
	onApply: (statementId: string, amount: number) => Promise<boolean> | boolean;
	/** Switch the payment to another statement; resolve true on success. */
	onChooseStatement?: (statementId: string) => Promise<boolean> | boolean;
	/** Defer the suggestion without changing a statement. */
	onDismiss?: () => Promise<boolean> | boolean;
	/** Undo a previous apply or dismiss. */
	onUndo?: () => Promise<boolean> | boolean;
	/** Report a local failure back to the shell, matching other suggestions. */
	onError?: (message: string) => void;
}

/**
 * One statement suggestion. It only asks; it never applies on render. Every
 * change to a statement is an explicit action, including a partial amount.
 */
export function StatementPaymentSuggestion({
	suggestion,
	position,
	total,
	readOnly,
	busy = false,
	error,
	onApply,
	onChooseStatement,
	onDismiss,
	onUndo,
	onError,
}: StatementPaymentSuggestionProps) {
	const max = maxApplyAmount(suggestion);
	const [selectedId, setSelectedId] = useState(suggestion.statementId);
	const [amount, setAmount] = useState(() => String(max));
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const amountRef = useRef<HTMLInputElement>(null);
	const amountErrorId = `statement-apply-${suggestion.key}-error`;
	const locked = readOnly || busy || pending;
	const paid = suggestion.status === "paid-in-full";
	const enteredAmount = Number(amount);
	const buttonAmount =
		Number.isFinite(enteredAmount) && enteredAmount > 0 ? enteredAmount : max;
	const options = [
		{
			statementId: suggestion.statementId,
			label: suggestion.statementLabel,
			remainingBalance: suggestion.remainingBalance,
		},
		...suggestion.alternatives,
	];
	const canChoose =
		(suggestion.actions.apply || suggestion.actions.applyPartial) &&
		options.length > 1 &&
		Boolean(onChooseStatement);

	const apply = async (value: string) => {
		if (locked) return;
		const invalid = validateApplyAmount(value, suggestion);
		if (invalid) {
			setFieldError(invalid);
			amountRef.current?.focus();
			return;
		}
		setFieldError(null);
		setPending(true);
		const ok = await onApply(selectedId, Number(value));
		setPending(false);
		if (!ok) onError?.("The payment could not be applied. Try again.");
	};

	const runAction = async (
		action: () => Promise<boolean> | boolean,
		failure: string,
	) => {
		if (locked) return;
		setPending(true);
		const ok = await action();
		setPending(false);
		if (!ok) onError?.(failure);
	};

	return (
		<div>
			<div className="mb-5 grid size-11 place-items-center rounded-xl bg-success-bg text-success-text">
				<CreditCard size={21} aria-hidden="true" />
			</div>
			<p className="mb-2 text-xs font-extrabold tracking-widest text-muted-foreground uppercase">
				{`Card payment · ${Math.min(position, total)} of ${total}`}
			</p>
			<h3 className="m-0 mb-3 text-xl leading-snug font-bold tracking-tight">
				Apply this payment to{" "}
				{suggestion.accountName ? `${suggestion.accountName}’s` : "the"}{" "}
				{suggestion.statementLabel}?
			</h3>
			{suggestion.evidence && (
				<Alert>
					<Info size={15} aria-hidden="true" />
					<AlertDescription>{suggestion.evidence}</AlertDescription>
				</Alert>
			)}

			<div className="mt-4 grid gap-2 rounded-lg border border-border p-3 text-sm">
				<div className="flex items-center justify-between gap-3">
					<span className="text-muted-foreground">Statement balance</span>
					<span className="tabular-nums">
						{exactMoney(suggestion.statementBalance)}
					</span>
				</div>
				<div className="flex items-center justify-between gap-3">
					<span className="text-muted-foreground">Applied</span>
					<span className="tabular-nums">
						{exactMoney(suggestion.appliedAmount)}
					</span>
				</div>
				<div className="flex items-center justify-between gap-3 font-semibold">
					<span>Remaining</span>
					<span className="tabular-nums">
						{exactMoney(suggestion.remainingBalance)}
					</span>
				</div>
				<div className="flex items-center justify-between gap-3">
					<span className="text-muted-foreground">Status</span>
					<Badge variant="secondary">
						{statementStatusLabel(suggestion.status)}
					</Badge>
				</div>
				{suggestion.dueDate && (
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground">Due date</span>
						<span className="tabular-nums">
							{dateLabel(suggestion.dueDate, true)}
						</span>
					</div>
				)}
			</div>

			{suggestion.matcherDetail && (
				<details className="mt-2">
					<summary className="cursor-pointer text-xs text-muted-foreground">
						Matcher detail
					</summary>
					<p className="m-0 mt-1 text-xs text-muted-foreground">
						{suggestion.matcherDetail}
					</p>
				</details>
			)}

			<div className="mt-4 grid gap-3">
				{canChoose && (
					<Field>
						<FieldLabel htmlFor={`statement-target-${suggestion.key}`}>
							Apply to statement
						</FieldLabel>
						<Select
							value={selectedId}
							disabled={locked}
							onValueChange={(value) => {
								if (!value) return;
								setSelectedId(value);
								const chosen = options.find(
									(option) => option.statementId === value,
								);
								setAmount(
									String(
										Math.min(
											maxApplyAmount(suggestion),
											chosen?.remainingBalance ?? max,
										),
									),
								);
								setFieldError(null);
								if (value !== suggestion.statementId)
									void runAction(
										() => onChooseStatement?.(value) ?? true,
										"The payment could not be moved. Try again.",
									);
							}}
						>
							<SelectTrigger
								id={`statement-target-${suggestion.key}`}
								aria-label="Apply to statement"
							>
								<SelectValue>
									{(value: string | null) =>
										options.find((option) => option.statementId === value)
											?.label ?? "Choose a statement"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{options.map((option) => (
									<SelectItem
										key={option.statementId}
										value={option.statementId}
									>
										{option.label} · {exactMoney(option.remainingBalance)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
				)}

				{suggestion.actions.applyPartial && !paid && (
					<Field>
						<FieldLabel htmlFor={`statement-apply-${suggestion.key}`}>
							Amount to apply
						</FieldLabel>
						<Input
							id={`statement-apply-${suggestion.key}`}
							ref={amountRef}
							name="applyAmount"
							type="number"
							inputMode="decimal"
							min={0.01}
							max={max}
							step={0.01}
							required
							aria-invalid={fieldError ? "true" : "false"}
							aria-describedby={fieldError ? amountErrorId : undefined}
							disabled={locked}
							value={amount}
							onChange={(event) => {
								setAmount(event.target.value);
								if (fieldError) setFieldError(null);
							}}
						/>
						<p className="m-0 text-xs leading-relaxed text-muted-foreground">
							Up to {exactMoney(max)} for this payment. Enter less to apply part
							of it.
						</p>
						<FieldError id={amountErrorId}>{fieldError ?? ""}</FieldError>
					</Field>
				)}

				{error && !fieldError && <FieldError>{error}</FieldError>}

				<div className="flex flex-wrap items-center gap-2">
					{suggestion.actions.apply && !paid && (
						<Button
							type="button"
							variant="default"
							disabled={locked}
							aria-label={`Apply ${exactMoney(buttonAmount)} to ${suggestion.statementLabel}`}
							onClick={() => void apply(amount)}
						>
							{pending ? "Applying…" : `Apply ${exactMoney(buttonAmount)}`}
						</Button>
					)}
					{suggestion.actions.undo && (
						<Button
							type="button"
							variant="secondary"
							disabled={locked}
							onClick={() =>
								void runAction(
									() => onUndo?.() ?? true,
									"The payment could not be undone. Try again.",
								)
							}
						>
							Undo
						</Button>
					)}
					{suggestion.actions.dismiss && !paid && onDismiss && (
						<Button
							type="button"
							variant="ghost"
							disabled={locked}
							onClick={() =>
								void runAction(
									() => onDismiss?.() ?? true,
									"The suggestion could not be deferred. Try again.",
								)
							}
						>
							Not now
						</Button>
					)}
				</div>
			</div>

			<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
				A suggestion never applies a payment on its own. Nothing is recorded
				until you apply an amount.
			</p>
		</div>
	);
}
