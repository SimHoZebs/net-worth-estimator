import { ArrowRight, LockKeyhole } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type Plan, validatePlan } from "../../domain/model.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { Notice } from "../Notice.tsx";
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
		<Modal title={title} onClose={close}>
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
				<fieldset
					disabled={Boolean(readOnlyReason)}
					className="grid grid-cols-2 gap-5 max-[600px]:gap-x-3 max-[600px]:gap-y-4 max-[370px]:grid-cols-1"
				>
					{children}
				</fieldset>
				{error && <ErrorNotice message={error} />}
				{confirmCancel ? (
					<div
						className="mt-6 rounded-lg border border-solid border-danger-border bg-danger-bg p-4"
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
							Apply unsaved changes <ArrowRight size={16} aria-hidden="true" />
						</Button>
					</div>
				)}
			</form>
		</Modal>
	);
}

export const sourceReadOnlyReason =
	"Change it at the source and import a refreshed plan.";
