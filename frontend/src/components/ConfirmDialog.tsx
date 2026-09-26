import type { ReactNode } from "react";
import { ErrorNotice, Modal } from "./ui.tsx";

export function ConfirmDialog({
	title,
	eyebrow,
	children,
	onCancel,
	onConfirm,
	cancelLabel,
	confirmLabel,
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
	busyLabel?: string;
	busy?: boolean;
	error?: string | null;
}) {
	return (
		<Modal title={title} eyebrow={eyebrow} onClose={onCancel}>
			{children}
			{error && <ErrorNotice message={error} />}
			<div className="modal-actions">
				<button type="button" className="button secondary" onClick={onCancel}>
					{cancelLabel}
				</button>
				<button
					type="button"
					className="button danger"
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? (busyLabel ?? confirmLabel) : confirmLabel}
				</button>
			</div>
		</Modal>
	);
}
