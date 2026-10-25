import { ArrowUpRight, AlertCircle } from "lucide-react";
import { TextButton } from "./Button.tsx";
import { Notice } from "./Notice.tsx";

export function ErrorNotice({
	message,
	action,
	onAction,
}: {
	message: string;
	action?: string;
	onAction?: () => void;
}) {
	return (
		<Notice tone="danger" className="mb-5 p-5 text-sm" role="alert">
			<AlertCircle size={20} className="mt-0.5" aria-hidden="true" />
			<div>
				<p className="my-1 whitespace-pre-line text-danger-text">{message}</p>
				{action && (
					<TextButton tone="danger" className="mt-2" onClick={onAction}>
						{action} <ArrowUpRight size={15} />
					</TextButton>
				)}
			</div>
		</Notice>
	);
}
