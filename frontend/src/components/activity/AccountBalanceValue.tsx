import type { AccountEdit } from "./useAccountEdit.ts";
import { exactMoney } from "../../domain/format.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group.tsx";

export function AccountBalanceValue({
	edit,
	readOnly,
}: {
	edit: AccountEdit;
	readOnly: boolean;
}) {
	const amount = parseDisplayNumber(edit.draft.balance);
	return (
		<div className="flex min-w-0 flex-col items-start gap-2 pt-1 pb-2 md:items-end">
			<Field orientation="vertical" className="w-full md:items-end">
				<FieldLabel htmlFor={`${edit.formId}-balance`}>Balance</FieldLabel>
				<InputGroup className="w-auto">
					<InputGroupAddon aria-hidden="true">$</InputGroupAddon>
					<InputGroupInput
						id={`${edit.formId}-balance`}
						aria-label="Balance (USD)"
						name="balance"
						type="number"
						required
						// A locked (synced) balance never blocks a kind change at the
						// HTML layer: the submit path reports a plain-language
						// mismatch on a field the owner cannot edit.
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
						onChange={(event) =>
							edit.update({ balance: event.target.value }, "balance")
						}
					/>
				</InputGroup>
			</Field>
			{edit.observedAt !== null && (
				<Field orientation="vertical" className="md:items-end">
					<FieldLabel htmlFor={`${edit.formId}-time`}>
						Adjustment time (UTC)
					</FieldLabel>
					<Input
						id={`${edit.formId}-time`}
						type="datetime-local"
						step="1"
						name="observedAt"
						required
						readOnly={readOnly || edit.saving}
						value={edit.observedAt}
						onChange={(event) => edit.setObservedAt(event.target.value)}
					/>
					{edit.previous.isFetching || edit.previous.isPending ? (
						<p
							role="status"
							className="m-0 text-xs text-muted-foreground md:text-right"
						>
							Loading balance at this time…
						</p>
					) : edit.previous.isError ? (
						<p role="alert" className="m-0 text-sm text-destructive">
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
						<p className="m-0 text-xs text-muted-foreground md:text-right">
							Previous balance {exactMoney(edit.previousBalance!)}.{" "}
							{amount !== null && (
								<>Adjustment {exactMoney(amount - edit.previousBalance!)}.</>
							)}
						</p>
					)}
					<p className="m-0 text-xs text-muted-foreground md:text-right">
						Recorded in Balance history as a balance adjustment, not income or
						spending.
					</p>
				</Field>
			)}
		</div>
	);
}
