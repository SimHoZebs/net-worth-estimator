import type { Plan } from "../../domain/model.ts";
import { useCurrentPosition } from "../../state/useCurrentPosition.ts";
import { TextButton } from "../Button.tsx";
import { Modal } from "../Modal.tsx";
import { Skeleton } from "../Skeleton.tsx";
import { PositionEvidence } from "./PositionEvidence.tsx";

export function CurrentPositionDialog({
	plan,
	onClose,
}: {
	plan: Plan;
	onClose: () => void;
}) {
	const position = useCurrentPosition();
	if (position.data)
		return (
			<PositionEvidence
				plan={plan}
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
