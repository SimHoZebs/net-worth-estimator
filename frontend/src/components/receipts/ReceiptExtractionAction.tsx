import { Check, ScanLine } from "lucide-react";
import { Button } from "../Button.tsx";

export function ReceiptExtractionAction({
	available,
	pending,
	complete,
	disabled,
	onExtract,
}: {
	available: boolean;
	pending: boolean;
	complete: boolean;
	disabled: boolean;
	onExtract: () => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Button
				variant={pending ? "primary" : "secondary"}
				disabled={!available || disabled || pending}
				aria-busy={pending}
				className="enabled:active:bg-active enabled:active:inset-shadow-sm"
				onClick={onExtract}
			>
				{pending ? (
					<progress
						aria-hidden="true"
						className="size-4 shrink-0 appearance-none rounded-full border-2 border-current border-t-transparent bg-transparent motion-safe:animate-spin [&::-webkit-progress-bar]:hidden [&::-webkit-progress-value]:hidden [&::-moz-progress-bar]:hidden"
					/>
				) : complete ? (
					<Check size={16} aria-hidden="true" />
				) : (
					<ScanLine size={16} aria-hidden="true" />
				)}
				{pending ? "Extracting details…" : "Extract details"}
			</Button>
			<p
				className={`text-xs ${complete && !pending ? "text-success-text" : "text-muted"}`}
				role="status"
			>
				{pending
					? "Scanning the receipt. Your attachment is saved."
					: !available
						? "Extraction is not configured. Enter the details below."
						: complete
							? "Receipt details extracted. Review them before you confirm."
							: "Extraction proposes details for review. Your corrections stay separate."}
			</p>
		</div>
	);
}
