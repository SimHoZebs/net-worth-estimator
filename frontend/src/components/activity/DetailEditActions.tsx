import { RotateCcw, Save } from "lucide-react";
import { Button, IconButton } from "../Button.tsx";
import { Notice } from "../Notice.tsx";

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
			<IconButton
				icon={RotateCcw}
				label="Discard changes"
				onClick={onDiscard}
				disabled={discardDisabled}
			/>
			<IconButton
				icon={Save}
				label="Save changes"
				type="submit"
				form={formId}
				disabled={disabled}
			/>
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
		<Notice tone="danger" className="block w-full" role="alert">
			<p className="mb-3 text-sm text-danger-text">
				Discard the changes in this form?
			</p>
			<div className="flex flex-wrap gap-2">
				<Button type="button" variant="secondary" onClick={onContinue}>
					Continue
				</Button>
				<Button type="button" variant="danger" onClick={onDiscard}>
					Discard changes
				</Button>
			</div>
		</Notice>
	);
}
