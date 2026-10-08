import { Download, HardDrive, LockKeyhole } from "lucide-react";
import type { FinancialModelDocument } from "../../api/index.ts";
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
		<section className="source-banner">
			<span className="source-banner-icon">
				<HardDrive size={25} />
			</span>
			<div>
				<h2>Your saved model.</h2>
			</div>
			<Badge tone="outline">
				<LockKeyhole size={12} />
				{sourceAccess}
			</Badge>
			<button
				type="button"
				className="button secondary"
				onClick={exportModel}
				disabled={!serverDocument}
			>
				<Download size={16} />
				Export model
			</button>
		</section>
	);
}
