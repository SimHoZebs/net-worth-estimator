import { useCurrentPosition } from "../../state/useCurrentPosition.ts";
import { useSavedAccounts } from "../../state/savedRows.ts";
import { TextButton } from "../Button.tsx";
import { Modal } from "../Modal.tsx";
import { Skeleton } from "../Skeleton.tsx";
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
		<Modal
			title="The basis of your net worth"
			eyebrow="Current position"
			onClose={onClose}
		>
			{position.status === "error" ? (
				<div role="status">
					Could not load current position.{" "}
					<TextButton onClick={position.retry}>
						Retry current position
					</TextButton>
				</div>
			) : (
				<div aria-busy="true">
					<Skeleton className="h-32 w-full" />
				</div>
			)}
		</Modal>
	);
}
