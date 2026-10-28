import { Download } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
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
	const pixels = useRef<HTMLImageElement>(null);
	const preview = useRef<string | null>(null);
	useEffect(() => {
		if (!image.data) return;
		const url = URL.createObjectURL(image.data);
		preview.current = url;
		const element = pixels.current;
		if (element) element.src = url;
		return () => {
			preview.current = null;
			element?.removeAttribute("src");
			URL.revokeObjectURL(url);
		};
	}, [image.data]);
	return (
		<figure className="flex flex-col gap-3">
			<div className="flex min-h-48 items-center justify-center overflow-hidden rounded-surface border border-line bg-surface-2 p-3">
				{image.data ? (
					<img
						ref={pixels}
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
				{image.data && (
					<Button
						variant="secondary"
						size="sm"
						className="w-fit"
						onClick={() => {
							if (!preview.current) return;
							const link = document.createElement("a");
							link.href = preview.current;
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
