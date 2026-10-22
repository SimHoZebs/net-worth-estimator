import { Download, HardDrive, LockKeyhole } from "lucide-react";
import type { FinancialModelDocument } from "../../api/index.ts";
import { Button } from "../../components/Button.tsx";
import { Badge } from "../../components/ui.tsx";
import { download } from "../../state/storage.ts";

export function SourceBanner({
	sourceAccess,
	serverDocument,
}: {
	sourceAccess: string;
	serverDocument: FinancialModelDocument | null;
}) {
	const exportModel = () => {
		if (!serverDocument) return;
		download({
			name: "waypoint-model.json",
			content: JSON.stringify(serverDocument, null, 2),
		});
	};
	return (
		<section className="mb-6 flex items-center gap-4 rounded-surface border border-success-border bg-success-bg p-6 [@media(max-width:600px)]:flex-wrap [@media(max-width:600px)]:gap-3 [@media(max-width:600px)]:p-5">
			<span className="text-success-text">
				<HardDrive size={25} />
			</span>
			<div className="flex-1 [@media(max-width:600px)]:flex-none">
				<h2 className="text-base [@media(max-width:600px)]:text-sm">
					Your saved model.
				</h2>
			</div>
			<Badge tone="outline">
				<LockKeyhole size={12} />
				{sourceAccess}
			</Badge>
			<Button
				type="button"
				variant="secondary"
				onClick={exportModel}
				disabled={!serverDocument}
			>
				<Download size={16} />
				Export model
			</Button>
		</section>
	);
}
