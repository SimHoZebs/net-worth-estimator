import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@/components/ui/alert.tsx";

export function DetailEditActions({
	formId,
	onDiscard,
	disabled,
	discardDisabled = false,
}: {
	formId: string;
	onDiscard: () => void;
	disabled: boolean;
	discardDisabled?: boolean;
}) {
	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Discard changes"
				title="Discard changes"
				onClick={onDiscard}
				disabled={discardDisabled}
			>
				<RotateCcw aria-hidden="true" />
			</Button>
			<Button
				type="submit"
				form={formId}
				variant="ghost"
				size="icon"
				aria-label="Save changes"
				title="Save changes"
				disabled={disabled}
			>
				<Save aria-hidden="true" />
			</Button>
		</>
	);
}

export function DiscardConfirm({
	onContinue,
	onDiscard,
}: {
	onContinue: () => void;
	onDiscard: () => void;
}) {
	return (
		<Alert variant="destructive" className="block w-full">
			<AlertTitle>Discard the changes in this form?</AlertTitle>
			<AlertDescription className="flex flex-wrap gap-2 pt-2">
				<Button type="button" variant="secondary" onClick={onContinue}>
					Continue
				</Button>
				<Button type="button" variant="destructive" onClick={onDiscard}>
					Discard changes
				</Button>
			</AlertDescription>
		</Alert>
	);
}
