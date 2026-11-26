import { useId, useState } from "react";
import type { Account } from "../../domain/model.ts";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";
import { deleteSavedAccount } from "../../state/accountWrites.ts";
import { useWorkspaceSaving } from "../../state/workspaceWrites.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { buttonVariants } from "@/components/ui/button.tsx";
import { FieldError } from "@/components/ui/field.tsx";

export function AccountDeleteSection({
	account,
	readOnly,
	busy,
	dirty,
	onDeleted,
}: {
	account: Account;
	readOnly: boolean;
	busy: boolean;
	dirty: boolean;
	onDeleted: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const workspaceSaving = useWorkspaceSaving();
	const titleId = useId();
	const reasonId = useId();
	const loan = isGroupedDisplay(account);
	const unavailableReason = account.syncOwned
		? "Synced accounts cannot be deleted."
		: readOnly
			? "This workspace is read-only, so accounts cannot be deleted."
			: null;
	const blocked = busy || workspaceSaving || deleting;
	useBeforeUnload(deleting);

	const requestDelete = () => {
		if (blocked || unavailableReason) return;
		setError(null);
		setOpen(true);
	};
	const confirmDelete = async () => {
		if (deleting || blocked || unavailableReason) return;
		setDeleting(true);
		setError(null);
		let rejection: string | null = null;
		const result = await deleteSavedAccount(account.id, (message) => {
			rejection = message;
			setError(message);
		});
		setDeleting(false);
		if (result.persisted) {
			setOpen(false);
			onDeleted();
			return;
		}
		setError(
			rejection ??
				"The account could not be deleted. Review the workspace notice and try again.",
		);
	};

	return (
		<section
			aria-labelledby={titleId}
			data-account-delete-section
			className="grid gap-3 border-t border-border pt-5"
		>
			<div className="grid gap-1">
				<h2 id={titleId} className="text-base font-semibold">
					{loan ? "Delete loan" : "Delete account"}
				</h2>
				<p className="max-w-prose text-sm text-muted-foreground">
					{loan
						? "Permanently delete this loan and its dependent financial history."
						: "Permanently delete this account and its dependent financial history."}
				</p>
			</div>
			{unavailableReason && (
				<p id={reasonId} className="text-sm text-muted-foreground">
					{unavailableReason}
				</p>
			)}
			<button
				type="button"
				data-slot="button"
				className={buttonVariants({
					variant: "destructive",
					className:
						"w-fit aria-disabled:pointer-events-none aria-disabled:opacity-50",
				})}
				disabled={blocked && !unavailableReason}
				aria-disabled={unavailableReason ? true : undefined}
				aria-describedby={unavailableReason ? reasonId : undefined}
				onClick={requestDelete}
			>
				{loan ? "Delete loan" : "Delete account"}
			</button>
			<AlertDialog
				open={open}
				onOpenChange={(next) => {
					if (deleting) return;
					setOpen(next);
					if (!next) setError(null);
				}}
			>
				<AlertDialogContent aria-busy={deleting}>
					<AlertDialogHeader>
						<AlertDialogTitle>{`Delete ${account.name}?`}</AlertDialogTitle>
						<AlertDialogDescription>
							{loan
								? "This permanently deletes both accounts in the loan, their balance history, the loan’s managed interest and payment schedules, and every recorded transaction, recurring schedule, planned purchase, statement allocation, and evaluation that depends on either account. Related settings and references are removed. This cannot be undone."
								: "This permanently deletes the account, its balance history, and every recorded transaction, recurring schedule, planned purchase, statement allocation, and evaluation that depends on it. Related settings and references are removed. This cannot be undone."}
							{dirty
								? " Unsaved changes to this account are also discarded."
								: ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					{error && <FieldError>{error}</FieldError>}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>
							{loan ? "Keep loan" : "Keep account"}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleting}
							onClick={() => void confirmDelete()}
						>
							{deleting ? "Deleting…" : loan ? "Delete loan" : "Delete account"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
