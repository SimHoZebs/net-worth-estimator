import { Check, LoaderCircle, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

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
				variant={pending ? "default" : "secondary"}
				disabled={!available || disabled || pending}
				aria-busy={pending}
				onClick={onExtract}
			>
				{pending ? (
					<LoaderCircle
						size={16}
						aria-hidden="true"
						className="shrink-0 motion-safe:animate-spin"
					/>
				) : complete ? (
					<Check size={16} aria-hidden="true" />
				) : (
					<ScanLine size={16} aria-hidden="true" />
				)}
				{pending ? "Extracting details…" : "Extract details"}
			</Button>
			<p
				className={`text-xs ${complete && !pending ? "text-success-text" : "text-muted-foreground"}`}
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
