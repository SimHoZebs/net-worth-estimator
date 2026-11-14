import { ArrowRight, LockKeyhole } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";

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
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && requestClose()) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				{readOnlyReason && (
					<Alert
						role="note"
						className={cn(
							"border-success-border bg-success-bg text-success-text",
						)}
					>
						<LockKeyhole size={18} aria-hidden="true" className="mt-px" />
						<AlertDescription className="text-success-text">
							{readOnlyReason}
						</AlertDescription>
					</Alert>
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
					{error && (
						<p
							role="alert"
							className="m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text"
						>
							{error}
						</p>
					)}
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
									className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
									onClick={() => setConfirmCancel(false)}
								>
									Continue
								</Button>
								<Button
									type="button"
									variant="destructive"
									className="min-h-10 bg-danger-solid px-4 py-2 text-sm leading-snug text-on-danger enabled:hover:brightness-90 focus-visible:outline-solid focus-visible:ring-0"
									onClick={onClose}
								>
									Discard changes
								</Button>
							</div>
						</div>
					) : (
						<div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-line pt-5">
							<Button
								type="button"
								variant="secondary"
								className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
								onClick={close}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="default"
								className="min-h-10 border-primary bg-primary px-4 py-2 text-sm leading-snug text-on-primary enabled:hover:bg-primary-hover enabled:hover:shadow-sm focus-visible:outline-solid focus-visible:ring-0"
								disabled={Boolean(readOnlyReason)}
							>
								Save changes <ArrowRight size={16} aria-hidden="true" />
							</Button>
						</div>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
