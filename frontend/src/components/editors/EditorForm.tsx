import { ArrowRight, LockKeyhole } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type Plan, validatePlan } from "../../domain/model.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { ErrorNotice, Modal } from "../ui.tsx";

export interface EditorProps {
	plan: Plan;
	onApply: (plan: Plan) => boolean;
	onClose: () => void;
}
export function EditorForm({
	title,
	onApply,
	onClose,
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
	useBeforeUnload(dirty);
	const close = () => (dirty ? setConfirmCancel(true) : onClose());
	return (
		<Modal title={title} eyebrow="Try it before you keep it" onClose={close}>
			<p className="form-intro">
				Changes create a temporary version. Compare the outcome before saving.
			</p>
			{readOnlyReason && (
				<div className="inline-notice">
					<LockKeyhole size={18} />
					{readOnlyReason}
				</div>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (readOnlyReason) return;
					const validated = validatePlan(
						buildPlan(new FormData(event.currentTarget)),
					);
					if (validated instanceof Error) {
						setError(validated.message);
						return;
					}
					if (onApply(validated)) onClose();
				}}
				onChange={() => setDirty(true)}
			>
				<fieldset disabled={Boolean(readOnlyReason)} className="form-grid">
					{children}
				</fieldset>
				{error && <ErrorNotice message={error} />}
				{confirmCancel ? (
					<div className="confirm-inline" role="alert">
						<p>Discard the edits in this form?</p>
						<button
							type="button"
							className="button secondary"
							onClick={() => setConfirmCancel(false)}
						>
							Keep editing
						</button>
						<button type="button" className="button danger" onClick={onClose}>
							Discard form edits
						</button>
					</div>
				) : (
					<div className="modal-actions">
						<button type="button" className="button secondary" onClick={close}>
							Cancel
						</button>
						<button
							type="submit"
							className="button primary"
							disabled={Boolean(readOnlyReason)}
						>
							Apply to temporary version <ArrowRight size={16} />
						</button>
					</div>
				)}
			</form>
		</Modal>
	);
}

export const sourceReadOnlyReason =
	"This record is owned by a read-only source. Edit it at the source and import a refreshed plan.";
