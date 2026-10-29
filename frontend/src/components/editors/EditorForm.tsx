import { ArrowRight, LockKeyhole } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type Plan, validatePlan } from "../../domain/model.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { Notice } from "../Notice.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";

export interface EditorProps {
	plan: Plan;
	/** Applied to the draft. May save immediately; async editors resolve
	 *  true only after the save completes so rapid edits serialize. */
	onApply: (plan: Plan) => boolean | Promise<boolean>;
	onClose: () => void;
	applyError?: string | null;
}
export function EditorForm({
	title,
	onApply,
	onClose,
	applyError,
	readOnlyReason,
	buildPlan,
	children,
}: Omit<EditorProps, "plan"> & {
	title: string;
	readOnlyReason?: string;
	buildPlan: (data: FormData) => Plan;
	children: ReactNode;
}) {
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [applyFailed, setApplyFailed] = useState(false);
	const [saving, setSaving] = useState(false);
	useBeforeUnload(dirty);
	const requestClose = () => {
		if (!dirty) return true;
		setConfirmCancel(true);
		return false;
	};
	const close = () => {
		if (requestClose()) onClose();
	};
	const displayedError =
		error ||
		(applyFailed
			? applyError ||
				"Your change could not be applied. Review the form and try again."
			: null);
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
					if (readOnlyReason || saving) return;
					setError(null);
					setApplyFailed(false);
					const validated = validatePlan(
						buildPlan(new FormData(event.currentTarget)),
					);
					if (validated instanceof Error) {
						setError(validated.message);
						return;
					}
					const result = onApply(validated);
					if (result instanceof Promise) {
						setSaving(true);
						void result.then(
							(ok) => {
								setSaving(false);
								if (ok) onClose();
								else setApplyFailed(true);
							},
							() => {
								setSaving(false);
								setApplyFailed(true);
							},
						);
					} else if (result) onClose();
					else setApplyFailed(true);
				}}
				onChange={() => setDirty(true)}
			>
				<fieldset
					disabled={Boolean(readOnlyReason) || saving}
					className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1"
				>
					{children}
				</fieldset>
				{displayedError && <ErrorNotice message={displayedError} />}
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
						<Button
							type="button"
							variant="secondary"
							onClick={close}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={Boolean(readOnlyReason) || saving}
						>
							{saving ? "Saving…" : "Apply unsaved changes"}{" "}
							<ArrowRight size={16} aria-hidden="true" />
						</Button>
					</div>
				)}
			</form>
		</Modal>
	);
}

export const sourceReadOnlyReason =
	"Change it at the source and import a refreshed plan.";
