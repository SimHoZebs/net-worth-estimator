import { ArrowUpRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
	Alert as ShadcnAlert,
	AlertDescription as ShadcnAlertDescription,
} from "@/components/ui/alert.tsx";

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
		<ShadcnAlert
			variant="destructive"
			className="mb-5 flex items-start gap-3 p-5 text-sm"
			role="alert"
		>
			<AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
			<ShadcnAlertDescription className="min-w-0 text-danger-text">
				<p className="my-1 whitespace-pre-line">{message}</p>
				{action && (
					<Button
						variant="link"
						className="mt-2 h-auto p-0 text-xs text-danger-text"
						onClick={onAction}
					>
						{action} <ArrowUpRight size={15} />
					</Button>
				)}
			</ShadcnAlertDescription>
		</ShadcnAlert>
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
