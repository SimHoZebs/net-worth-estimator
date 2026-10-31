import { ArrowRight, LockKeyhole } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { Notice } from "../Notice.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";

/**
 * Direct row edit shell. The form owns its values and saves straight to
 * the server; there is no draft layer. Failed saves keep the form open with
 * the entered values and a server notice, and close only after confirmed save.
 */
export function EditorForm({
	title,
	onClose,
	readOnlyReason,
	onSubmit,
	children,
}: {
	title: string;
	onClose: () => void;
	readOnlyReason?: string;
	onSubmit: (data: FormData) => void | Promise<void>;
	children: ReactNode;
}) {
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	useBeforeUnload(dirty);
	const requestClose = () => {
		if (!dirty) return true;
		setConfirmCancel(true);
		return false;
	};
	const close = () => {
		if (requestClose()) onClose();
	};
	return (
		<Modal title={title} onClose={onClose} onCloseRequest={requestClose}>
			{readOnlyReason && (
				<Notice>
					<LockKeyhole size={18} aria-hidden="true" className="mt-px" />
					{readOnlyReason}
				</Notice>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (readOnlyReason) return;
					setError(null);
					try {
						const result = onSubmit(new FormData(event.currentTarget));
						if (result instanceof Promise)
							result.catch((cause: unknown) =>
								setError(
									cause instanceof Error
										? cause.message
										: "Your change could not be applied. Review the form and try again.",
								),
							);
					} catch (cause) {
						setError(
							cause instanceof Error
								? cause.message
								: "Your change could not be applied. Review the form and try again.",
						);
					}
				}}
				onChange={() => setDirty(true)}
			>
				<fieldset
					disabled={Boolean(readOnlyReason)}
					className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1"
				>
					{children}
				</fieldset>
				{error && <ErrorNotice message={error} />}
				{confirmCancel ? (
					<div
						className="mt-6 rounded-surface border border-solid border-danger-border bg-danger-bg p-4"
						role="alert"
					>
						<p className="mb-3 text-sm text-danger-text">
							Discard the changes in this form?
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setConfirmCancel(false)}
							>
								Continue
							</Button>
							<Button type="button" variant="danger" onClick={onClose}>
								Discard changes
							</Button>
						</div>
					</div>
				) : (
					<div className={dialogActionsStyles}>
						<Button type="button" variant="secondary" onClick={close}>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={Boolean(readOnlyReason)}
						>
							Save changes <ArrowRight size={16} aria-hidden="true" />
						</Button>
					</div>
				)}
			</form>
		</Modal>
	);
}
