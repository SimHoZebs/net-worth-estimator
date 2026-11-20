import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { dateLabel, exactMoney } from "@/domain/format.ts";
import type { useStatementPaymentReview } from "./useStatementPaymentReview.ts";

export function AppliedStatementPayment({
	current: { allocation, read },
	readOnly,
	undoing,
	undoError,
	onUndo,
}: {
	current: NonNullable<ReturnType<typeof useStatementPaymentReview>["current"]>;
	readOnly: boolean;
	undoing: boolean;
	undoError: boolean;
	onUndo: () => Promise<void>;
}) {
	return (
		<Alert>
			<AlertTitle>Statement payment applied</AlertTitle>
			<AlertDescription>
				<p>
					{exactMoney(allocation.amount)} applied to the statement closed{" "}
					{dateLabel(read.statement.closingDate, true)}.{" "}
					{read.remaining === 0
						? "Paid in full."
						: `${exactMoney(read.remaining)} remains.`}
				</p>
				{!readOnly && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={undoing}
						onClick={() => void onUndo()}
					>
						{undoing ? "Undoing…" : "Undo statement payment"}
					</Button>
				)}
				{undoError && (
					<p role="alert">
						The statement payment could not be undone. Try again.
					</p>
				)}
			</AlertDescription>
		</Alert>
	);
}
