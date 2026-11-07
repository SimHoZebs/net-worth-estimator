import { useId, useState } from "react";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { FieldError } from "../ErrorNotice.tsx";
import { InputField } from "../Field.tsx";
import { Modal } from "../Modal.tsx";

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
	const valid =
		occurredDate.trim() !== "" && (pending || postedDate.trim() !== "");
	const apply = () => {
		if (!valid) {
			setError(
				pending
					? "Choose the occurred date."
					: "Choose both the occurred date and the posted date.",
			);
			return;
		}
		onApply(occurredDate, pending ? "" : postedDate);
	};
	return (
		<Modal
			title="Transaction dates"
			titleSize="plain"
			label="Transaction dates"
			className="max-w-sm"
			onClose={onClose}
		>
			<div className="flex flex-col gap-4">
				<InputField
					id={occurredId}
					label="Occurred"
					hint="The day the transaction happened."
					type="date"
					required
					value={occurredDate}
					disabled={locked}
					onChange={(event) => {
						setOccurredDate(event.target.value);
						setError(null);
					}}
				/>
				<InputField
					id={postedId}
					label="Posted"
					hint={
						pending
							? "Not yet posted — posts later."
							: "The day the bank posted the transaction."
					}
					type="date"
					required={!pending}
					value={postedDate}
					disabled={locked || pending}
					onChange={(event) => {
						setPostedDate(event.target.value);
						setError(null);
					}}
				/>
			</div>
			<FieldError message={error} />
			<div className={dialogActionsStyles}>
				<Button type="button" variant="secondary" onClick={onClose}>
					Cancel
				</Button>
				<Button type="button" variant="primary" onClick={apply}>
					Apply
				</Button>
			</div>
		</Modal>
	);
}
