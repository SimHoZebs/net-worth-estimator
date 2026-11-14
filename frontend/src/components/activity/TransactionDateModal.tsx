import { useId, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";

/**
 * Small dialog for the pair of transaction dates. The detail keeps the
 * read display for each date but edits both fields together here, so the
 * posted date is never hidden behind a status label.
 */
export function TransactionDateModal({
	occurred,
	posted,
	pending,
	postedLocked,
	onClose,
	onApply,
}: {
	occurred: string;
	posted: string;
	pending: boolean;
	/** Locked when the detail is read-only. */
	postedLocked: boolean;
	onClose: () => void;
	onApply: (occurredDate: string, postedDate: string) => void;
}) {
	const id = useId();
	const occurredId = `${id}-occurred`;
	const postedId = `${id}-posted`;
	const [occurredDate, setOccurredDate] = useState(occurred);
	const [postedDate, setPostedDate] = useState(posted);
	const [error, setError] = useState<string | null>(null);
	const locked = postedLocked;
	const apply = () => {
		if (occurredDate.trim() === "") {
			setError("Choose the occurred date.");
			return;
		}
		if (!pending && postedDate.trim() === "") {
			setError("Choose the posted date.");
			return;
		}
		onApply(occurredDate, postedDate);
	};
	return (
		<Dialog
			open={true}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-sm overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Transaction dates</DialogTitle>
					<DialogDescription className="sr-only">
						Edit the occurred and posted dates for this transaction
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<Field>
						<FieldLabel htmlFor={occurredId}>Occurred</FieldLabel>
						<Input
							id={occurredId}
							type="date"
							required
							value={occurredDate}
							disabled={locked}
							onChange={(event) => {
								setOccurredDate(event.target.value);
								setError(null);
							}}
						/>
						<FieldDescription>
							The day the transaction happened.
						</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={postedId}>Posted</FieldLabel>
						<Input
							id={postedId}
							type="date"
							required={false}
							value={postedDate}
							disabled={locked}
							onChange={(event) => {
								setPostedDate(event.target.value);
								setError(null);
							}}
						/>
						<FieldDescription>
							{pending
								? "Not yet posted — set a date to mark as posted."
								: "The day the bank posted the transaction."}
						</FieldDescription>
					</Field>
				</div>
				{error && (
					<p role="alert" className="m-0 text-sm text-danger-text">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" onClick={apply}>
						Apply
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
