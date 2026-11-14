import type { AccountEdit } from "./useAccountEdit.ts";
import { exactMoney } from "../../domain/format.ts";
import { transactionControlStyles } from "./transactionDetailStyles.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/lib/utils.ts";

export function AccountBalanceValue({
	edit,
	readOnly,
}: {
	edit: AccountEdit;
	readOnly: boolean;
}) {
	const amount = parseDisplayNumber(edit.draft.balance);
	return (
		<div
			className={`flex min-w-0 flex-col items-start gap-2 pt-1 pb-2 md:items-end ${edit.observedAt !== null ? "md:w-80" : ""}`}
		>
			<span className="text-xs text-muted">Balance</span>
			<span className="type-value inline-flex min-w-0 items-baseline gap-1 text-2xl leading-[1.3] font-medium tracking-tight">
				<span aria-hidden="true">$</span>
				<Input
					id={`${edit.formId}-balance`}
					aria-label="Balance (USD)"
					name="balance"
					type="number"
					required
					// A locked (synced) balance never blocks a kind change at the
					// HTML layer: the submit path reports a plain-language
					// mismatch instead of a constraint bubble on a field the
					// owner cannot edit.
					min={
						readOnly
							? undefined
							: edit.draft.kind === "debt"
								? "-10000000000"
								: "0"
					}
					max={
						readOnly
							? undefined
							: edit.draft.kind === "debt"
								? "0"
								: "10000000000"
					}
					step="0.01"
					value={edit.draft.balance}
					readOnly={readOnly || edit.saving}
					className={cn(transactionControlStyles({ shape: "amount" }))}
					onChange={(event) =>
						edit.update({ balance: event.target.value }, "balance")
					}
				/>
			</span>
			{edit.observedAt !== null && (
				<div className="flex flex-col items-start gap-2 md:items-end">
					<Label
						htmlFor={`${edit.formId}-time`}
						className="inline-flex max-w-full flex-wrap items-center gap-2 text-sm text-muted"
					>
						Adjustment time (UTC)
						<Input
							id={`${edit.formId}-time`}
							type="datetime-local"
							step="1"
							name="observedAt"
							required
							readOnly={readOnly || edit.saving}
							value={edit.observedAt}
							className={cn(transactionControlStyles({ shape: "date" }))}
							onChange={(event) => edit.setObservedAt(event.target.value)}
						/>
					</Label>
					{edit.previous.isFetching || edit.previous.isPending ? (
						<p role="status" className="m-0 text-xs text-muted md:text-right">
							Loading balance at this time…
						</p>
					) : edit.previous.isError ? (
						<p role="alert" className="m-0 text-sm text-danger-text">
							The balance could not be loaded.{" "}
							<Button
								type="button"
								variant="link"
								onClick={() => void edit.previous.refetch()}
							>
								Retry balance
							</Button>
						</p>
					) : (
						<p className="m-0 text-xs text-muted md:text-right">
							Previous balance {exactMoney(edit.previousBalance!)}.{" "}
							{amount !== null && (
								<>Adjustment {exactMoney(amount - edit.previousBalance!)}.</>
							)}
						</p>
					)}
					<p className="m-0 text-xs text-muted md:text-right">
						Recorded in Balance history as a balance adjustment, not income or
						spending.
					</p>
				</div>
			)}
		</div>
	);
}
