import { Download } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useReceiptImage } from "@/state/receipts.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Button } from "../Button.tsx";

export function ReceiptPreview({
	id,
	digest,
	filename,
	actions,
}: {
	id: string;
	digest: string;
	filename: string;
	actions?: ReactNode;
}) {
	const image = useReceiptImage(id, digest);
	const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(
		null,
	);
	useEffect(() => {
		if (!image.data) return;
		const url = URL.createObjectURL(image.data);
		// Allocate a browser resource after commit, and expose its handle to JSX.
		// This state is a resource handle, not a copy of the receipt's fields.
		// oxlint-disable-next-line react/set-state-in-effect
		setPreview({ blob: image.data, url });
		return () => {
			URL.revokeObjectURL(url);
		};
	}, [image.data]);
	const url = preview?.blob === image.data ? preview?.url : undefined;
	return (
		<figure className="flex flex-col gap-3">
			<div className="flex min-h-48 items-center justify-center overflow-hidden rounded-surface border border-line bg-surface-2 p-3">
				{url ? (
					<img
						src={url}
						alt={`Receipt: ${filename}`}
						className="max-h-[60dvh] w-full object-contain"
					/>
				) : (
					<p className="p-4 text-sm text-muted" role="status">
						{image.isError ? "Image unavailable" : "Loading private image…"}
					</p>
				)}
			</div>
			{image.error && (
				<ErrorNotice
					message={image.error.message}
					action="Retry image"
					onAction={() => void image.refetch()}
				/>
			)}
			<div className="flex flex-wrap gap-2">
				{url && (
					<Button
						variant="secondary"
						size="sm"
						className="w-fit"
						onClick={() => {
							const link = document.createElement("a");
							link.href = url;
							link.download = filename;
							link.click();
						}}
					>
						<Download size={15} aria-hidden="true" />
						Download image
					</Button>
				)}
				{actions}
			</div>
		</figure>
	);
}
