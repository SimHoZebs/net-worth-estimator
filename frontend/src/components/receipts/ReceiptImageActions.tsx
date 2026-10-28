import { ImageUp, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "../Button.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";

export function ReceiptImageActions({
	revision,
	readOnly,
	busy,
	replacing,
	deleting,
	onReplace,
	onDelete,
}: {
	revision: number;
	readOnly: boolean;
	busy: boolean;
	replacing: boolean;
	deleting: boolean;
	onReplace: (image: File, revision: number) => Promise<void>;
	onDelete: () => Promise<void>;
}) {
	const picker = useRef<HTMLInputElement>(null);
	const [prompt, setPrompt] = useState<
		| { kind: "replace"; image: File; revision: number }
		| { kind: "delete" }
		| null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const select = (event: ChangeEvent<HTMLInputElement>) => {
		const image = event.target.files?.[0];
		event.target.value = "";
		if (!image || busy || readOnly) return;
		setError(null);
		setPrompt({ kind: "replace", image, revision });
	};
	if (readOnly) return null;
	return (
		<>
			<Button
				variant="secondary"
				size="sm"
				disabled={busy}
				onClick={() => picker.current?.click()}
			>
				<ImageUp size={15} aria-hidden="true" />
				Replace image
			</Button>
			<input
				ref={picker}
				name="replacementImage"
				type="file"
				accept="image/jpeg,image/png"
				aria-label="Replace receipt image"
				className="sr-only"
				tabIndex={-1}
				disabled={busy}
				onChange={select}
			/>
			<Button
				variant="danger"
				size="sm"
				disabled={busy}
				onClick={() => {
					setError(null);
					setPrompt({ kind: "delete" });
				}}
			>
				<Trash2 size={15} aria-hidden="true" />
				Delete receipt
			</Button>
			{prompt && (
				<ConfirmDialog
					title={
						prompt.kind === "replace"
							? "Replace this receipt?"
							: "Delete this receipt?"
					}
					onCancel={() => {
						if (!busy) setPrompt(null);
					}}
					onConfirm={() => {
						if (busy) return;
						const operation =
							prompt.kind === "replace"
								? onReplace(prompt.image, prompt.revision)
								: onDelete();
						void operation
							.then(() => setPrompt(null))
							.catch((cause: unknown) =>
								setError(
									cause instanceof Error
										? cause.message
										: "The receipt could not be changed.",
								),
							);
					}}
					cancelLabel="Keep receipt"
					confirmLabel={
						prompt.kind === "replace" ? "Replace receipt" : "Delete receipt"
					}
					busyLabel={replacing ? "Replacing receipt…" : "Deleting receipt…"}
					busy={busy || replacing || deleting}
					error={error}
				>
					<p className="text-sm text-muted">
						{prompt.kind === "replace"
							? "This replaces the image and clears extracted details, saved drafts, confirmed content, and unsaved receipt edits."
							: "This deletes the image and all extracted, draft, and confirmed receipt content."}{" "}
						The transaction stays unchanged.
					</p>
				</ConfirmDialog>
			)}
		</>
	);
}
