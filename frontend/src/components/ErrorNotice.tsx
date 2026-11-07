import { ArrowUpRight, AlertCircle } from "lucide-react";
import { TextButton } from "./Button.tsx";
import { Notice } from "./Notice.tsx";

export function ErrorNotice({
	message,
	action,
	onAction,
}: {
	message?: string | null;
	action?: string;
	onAction?: () => void;
}) {
	const notice = message ? (
		<Notice tone="danger" className="mb-5 p-5 text-sm" role="alert">
			<AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
			<div className="min-w-0 break-words">
				<p className="my-1 whitespace-pre-line text-danger-text">{message}</p>
				{action && (
					<TextButton tone="danger" className="mt-2" onClick={onAction}>
						{action} <ArrowUpRight size={15} />
					</TextButton>
				)}
			</div>
		</Notice>
	) : null;
	return notice;
}

/** Field feedback renders only while a message exists. */
export function FieldError({
	message,
	id,
}: {
	message?: string | null;
	id?: string;
}) {
	if (!message) return null;
	return (
		<p
			id={id}
			role="alert"
			aria-live="assertive"
			aria-atomic="true"
			// Keyboard users must be able to scroll wrapped field feedback.
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
			tabIndex={0}
			className="m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text"
		>
			{message}
		</p>
	);
}
