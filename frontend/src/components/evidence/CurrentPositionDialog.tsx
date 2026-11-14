import { useCurrentPosition } from "../../state/useCurrentPosition.ts";
import { useSavedAccounts } from "../../state/savedState.ts";
import { Button } from "@/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { PositionEvidence } from "./PositionEvidence.tsx";

export function CurrentPositionDialog({ onClose }: { onClose: () => void }) {
	const position = useCurrentPosition();
	const accounts = useSavedAccounts();
	if (position.data && accounts)
		return (
			<PositionEvidence
				accounts={accounts}
				position={position.data}
				onClose={onClose}
			/>
		);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
						Current position
					</p>
					<DialogTitle>The basis of your net worth</DialogTitle>
				</DialogHeader>
				{position.status === "error" ? (
					<div role="status">
						Could not load current position.{" "}
						<Button variant="link" onClick={position.retry}>
							Retry current position
						</Button>
					</div>
				) : (
					<div aria-busy="true">
						<Skeleton className="h-32 w-full" role="status" />
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
