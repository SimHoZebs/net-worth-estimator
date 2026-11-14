import { Download } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useReceiptImage } from "@/state/receipts.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";

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
			<div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted p-3">
				{url ? (
					<img
						src={url}
						alt={`Receipt: ${filename}`}
						className="max-h-[60dvh] w-full object-contain"
					/>
				) : image.error ? (
					<Alert variant="destructive">
						<AlertDescription className="min-w-0 break-words">
							<p className="my-1 whitespace-pre-line">{image.error.message}</p>
							<Button
								variant="link"
								className="mt-2 px-0 py-0.5 text-xs font-semibold"
								onClick={() => void image.refetch()}
							>
								Retry image
							</Button>
						</AlertDescription>
					</Alert>
				) : (
					<p className="p-4 text-sm text-muted-foreground" role="status">
						{image.isError ? "Image unavailable" : "Loading private image…"}
					</p>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				{url && (
					<Button
						variant="secondary"
						size="sm"
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
