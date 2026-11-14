import { useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button.tsx";
import { FieldError } from "@/components/ui/field.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";

/**
 * Shared close contract for editor dialogs. Dirty tracking, the busy guard,
 * and failed-save state stay with each form; only the discard decision is
 * shared. Busy forms never ask and never close.
 */
export function useDiscardGuard({
	dirty,
	busy,
}: {
	dirty: boolean;
	busy: boolean;
}) {
	const [confirming, setConfirming] = useState(false);
	useBeforeUnload(dirty || busy);
	return {
		confirming,
		dismissConfirm: () => setConfirming(false),
		requestClose: (close: () => void) => {
			if (busy) return;
			if (dirty) setConfirming(true);
			else close();
		},
	};
}

/** Nested confirmation for discarding an editor. Lives outside any form. */
export function DiscardConfirm({
	open,
	onContinue,
	onDiscard,
}: {
	open: boolean;
	onContinue: () => void;
	onDiscard: () => void;
}) {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onContinue();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Discard changes?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogDescription>
					Your entries are not saved yet. Discarding closes the editor without
					saving.
				</AlertDialogDescription>
				<AlertDialogFooter>
					<AlertDialogCancel>Continue editing</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onDiscard}>
						Discard changes
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/**
 * One dialog, one form, one footer. Dialogs whose form lives elsewhere (the
 * account editor splits identity from detail forms) compose Dialog,
 * useDiscardGuard, and DiscardConfirm directly instead.
 */
export function EditorDialog({
	title,
	onClose,
	dirty,
	busy,
	error,
	submitLabel,
	pendingLabel = "Saving…",
	submitDisabled,
	onSubmit,
	children,
}: {
	title: string;
	onClose: () => void;
	dirty: boolean;
	busy: boolean;
	error: string | null;
	submitLabel: string;
	pendingLabel?: string;
	submitDisabled?: boolean;
	onSubmit: () => void;
	children: ReactNode;
}) {
	const guard = useDiscardGuard({ dirty, busy });
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) guard.requestClose(onClose);
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<form
					className="flex min-h-0 flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit();
					}}
				>
					{children}
					{error ? <FieldError>{error}</FieldError> : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => guard.requestClose(onClose)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || submitDisabled}>
							{busy ? pendingLabel : submitLabel}
						</Button>
					</DialogFooter>
				</form>
				<DiscardConfirm
					open={guard.confirming}
					onContinue={guard.dismissConfirm}
					onDiscard={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}
