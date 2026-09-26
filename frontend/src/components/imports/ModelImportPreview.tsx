import { FileJson } from "lucide-react";
import type { ReactNode } from "react";
import type { FinancialModelDocument } from "../../api/index.ts";
import { Modal } from "../ui.tsx";

export function ModelImportPreview({
	document,
	eyebrow,
	onClose,
	children,
	footer,
}: {
	document: FinancialModelDocument;
	eyebrow: string;
	onClose: () => void;
	children: ReactNode;
	footer: ReactNode;
}) {
	return (
		<Modal
			title="Review server model import"
			eyebrow={eyebrow}
			onClose={onClose}
		>
			<div className="import-summary">
				<FileJson size={30} />
				<h3>
					{document.sourcePath.split("/").filter(Boolean).at(-1) ||
						"Waypoint model"}
				</h3>
				<p>
					{document.accounts.length} accounts · {document.postings.length}{" "}
					postings · {document.checkpoints.length} checkpoints
				</p>
				<p>
					{document.evaluations.financialIndependence.length +
						document.evaluations.netWorthThreshold.length +
						document.evaluations.postingFulfillment.length}{" "}
					evaluations
				</p>
			</div>
			{children}
			<div className="modal-actions">{footer}</div>
		</Modal>
	);
}
