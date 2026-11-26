import type { AccountEdit } from "./useAccountEdit.ts";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@/components/ui/field.tsx";
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
	const loading =
		edit.balanceAtTimeQuery.isFetching || edit.balanceAtTimeQuery.isPending;
	const failed = edit.balanceAtTimeQuery.isError;
	const timeId = `${edit.formId}-time`;
	const helpId = `${timeId}-help`;
	const loadingId = `${timeId}-loading`;
	const errorId = `${timeId}-error`;
	const describedBy = [
		helpId,
		loading ? loadingId : null,
		failed ? errorId : null,
	]
		.filter(Boolean)
		.join(" ");
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
						// mismatch on a field the owner cannot edit. The minimum
						// stays permissive because recorded actuals can already
						// hold a negative total; submit validation owns kind rules.
						min={readOnly ? undefined : "-10000000000"}
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
				<Field
					orientation="vertical"
					className="md:items-end"
					data-invalid={failed ? "true" : undefined}
				>
					<FieldLabel htmlFor={timeId}>Balance time (UTC)</FieldLabel>
					<FieldDescription id={helpId} className="m-0 text-xs md:text-right">
						Transactions after this time update this balance.
					</FieldDescription>
					<Input
						id={timeId}
						type="datetime-local"
						step="1"
						name="observedAt"
						required
						readOnly={readOnly || edit.saving}
						value={edit.observedAt}
						onChange={(event) => edit.setObservedAt(event.target.value)}
						aria-describedby={describedBy}
						aria-invalid={failed ? true : undefined}
						aria-busy={loading || undefined}
					/>
					{loading && (
						<FieldDescription
							id={loadingId}
							className="m-0 text-xs md:text-right"
						>
							Loading balance at this time…
						</FieldDescription>
					)}
					{failed && (
						<FieldError className="m-0 text-sm md:text-right">
							<span id={errorId}>
								The balance at this time could not be loaded.
							</span>{" "}
							<Button
								type="button"
								variant="link"
								onClick={() => void edit.balanceAtTimeQuery.refetch()}
							>
								Retry balance
							</Button>
						</FieldError>
					)}
				</Field>
			)}
		</div>
	);
}
