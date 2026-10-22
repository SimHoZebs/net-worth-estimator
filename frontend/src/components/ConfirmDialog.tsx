import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { dialogActionsStyles } from "./dialogStyles.ts";
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
			<div className={dialogActionsStyles}>
				<Button type="button" variant="secondary" onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button
					type="button"
					variant="danger"
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? (busyLabel ?? confirmLabel) : confirmLabel}
				</Button>
			</div>
		</Modal>
	);
}
