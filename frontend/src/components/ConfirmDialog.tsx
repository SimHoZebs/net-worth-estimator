import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { dialogActionsStyles } from "./dialogStyles.ts";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { Modal } from "./Modal.tsx";

export function ConfirmDialog({
	title,
	eyebrow,
	children,
	onCancel,
	onConfirm,
	cancelLabel,
	confirmLabel,
	confirmVariant = "danger",
	busyLabel,
	busy = false,
	error,
}: {
	title: string;
	eyebrow?: string;
	children: ReactNode;
	onCancel: () => void;
	onConfirm: () => void;
	cancelLabel: string;
	confirmLabel: string;
	/** Danger for destructive removal; primary for record-and-close actions. */
	confirmVariant?: "primary" | "danger";
	busyLabel?: string;
	busy?: boolean;
	error?: string | null;
}) {
	return (
		<Modal
			title={title}
			eyebrow={eyebrow}
			onClose={onCancel}
			onCloseRequest={() => !busy}
		>
			{children}
			{error && <ErrorNotice message={error} />}
			<div className={dialogActionsStyles}>
				<Button
					type="button"
					variant="secondary"
					onClick={onCancel}
					disabled={busy}
				>
					{cancelLabel}
				</Button>
				<Button
					type="button"
					variant={confirmVariant}
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? (busyLabel ?? confirmLabel) : confirmLabel}
				</Button>
			</div>
		</Modal>
	);
}
