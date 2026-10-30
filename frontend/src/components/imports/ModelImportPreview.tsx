import { FileJson } from "lucide-react";
import type { ReactNode } from "react";
import type { FinancialModel } from "../../api/index.ts";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { Modal } from "../Modal.tsx";

export function ModelImportPreview({
	model,
	eyebrow,
	onClose,
	children,
	footer,
}: {
	model: FinancialModel;
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
					{model.sourcePath.split("/").filter(Boolean).at(-1) ||
						"Waypoint model"}
				</h3>
				<p className="mt-2 text-xs">
					{model.accounts.length} accounts · {model.postings.length} postings ·{" "}
					{model.checkpoints.length} checkpoints
				</p>
				<p className="mt-2 text-xs">
					{model.evaluations.financialIndependence.length +
						model.evaluations.netWorthThreshold.length +
						model.evaluations.accountBalance.length +
						model.evaluations.postingFulfillment.length +
						(model.evaluations.cycleFulfillment ?? []).length}{" "}
					evaluations
				</p>
			</div>
			{children}
			<div className={dialogActionsStyles}>{footer}</div>
		</Modal>
	);
}
