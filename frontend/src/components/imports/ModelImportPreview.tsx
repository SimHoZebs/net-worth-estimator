import { FileJson } from "lucide-react";
import type { ReactNode } from "react";
import type { FinancialModel } from "../../api/index.ts";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";

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
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
						{eyebrow}
					</p>
					<DialogTitle>Review server model import</DialogTitle>
				</DialogHeader>
				<div className="py-5 text-center">
					<FileJson size={30} className="mb-3 text-primary" />
					<h3 className="text-xl">
						{model.sourcePath.split("/").filter(Boolean).at(-1) ||
							"Waypoint model"}
					</h3>
					<p className="mt-2 text-xs">
						{model.accounts.length} accounts · {model.transactions.length}{" "}
						transactions · {model.checkpoints.length} checkpoints
					</p>
					<p className="mt-2 text-xs">
						{model.evaluations.financialIndependence.length +
							model.evaluations.netWorthThreshold.length +
							model.evaluations.accountBalance.length +
							model.evaluations.transactionFulfillment.length +
							(model.evaluations.cycleFulfillment ?? []).length}{" "}
						evaluations
					</p>
				</div>
				{children}
				<DialogFooter>{footer}</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
