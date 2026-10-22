import { FileJson } from "lucide-react";
import type { ReactNode } from "react";
import type { FinancialModelDocument } from "../../api/index.ts";
import { dialogActionsStyles } from "../dialogStyles.ts";
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
			<div className="py-5 text-center">
				<FileJson size={30} className="mb-3 text-primary" />
				<h3 className="text-xl">
					{document.sourcePath.split("/").filter(Boolean).at(-1) ||
						"Waypoint model"}
				</h3>
				<p className="mt-2 text-xs">
					{document.accounts.length} accounts · {document.postings.length}{" "}
					postings · {document.checkpoints.length} checkpoints
				</p>
				<p className="mt-2 text-xs">
					{document.evaluations.financialIndependence.length +
						document.evaluations.netWorthThreshold.length +
						document.evaluations.accountBalance.length +
						document.evaluations.postingFulfillment.length +
						(document.evaluations.cycleFulfillment ?? []).length}{" "}
					evaluations
				</p>
			</div>
			{children}
			<div className={dialogActionsStyles}>{footer}</div>
		</Modal>
	);
}
