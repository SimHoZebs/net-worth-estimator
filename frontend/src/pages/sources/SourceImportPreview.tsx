import { Download, FileJson, LockKeyhole, TriangleAlert } from "lucide-react";
import { ModelImportPreview } from "../../components/imports/ModelImportPreview.tsx";
import { Modal } from "../../components/ui.tsx";
import { dateLabel } from "../../domain/format.ts";
import type { ModelImportController } from "../../state/useModelImport.ts";

export function SourceImportPreview({
	hasDraft,
	canImportServer,
	readOnly,
	controller,
}: {
	hasDraft: boolean;
	canImportServer: boolean;
	readOnly: boolean;
	controller: Pick<
		ModelImportController,
		| "planCandidate"
		| "serverCandidate"
		| "closePreview"
		| "exportPlan"
		| "applyPlan"
		| "importing"
		| "importServerModel"
	>;
}) {
	const {
		planCandidate,
		serverCandidate,
		closePreview,
		exportPlan,
		applyPlan,
		importing,
		importServerModel,
	} = controller;
	return (
		<>
			{planCandidate && (
				<Modal
					title="Review imported plan"
					eyebrow="Your current plan is still intact"
					onClose={closePreview}
				>
					<div className="import-summary">
						<FileJson size={30} />
						<h3>{planCandidate.name}</h3>
						<p>
							{planCandidate.accounts.length} accounts ·{" "}
							{planCandidate.movements.length} movements ·{" "}
							{planCandidate.goals.length} goals
						</p>
						<p>
							Starts {dateLabel(planCandidate.startDate, true)} ·{" "}
							{planCandidate.origin === "example"
								? "Example data"
								: "Personal data"}
						</p>
					</div>
					{hasDraft && (
						<div className="inline-notice amber">
							<TriangleAlert size={18} />
							Save or discard your temporary version before importing another
							plan. Export is available now.
						</div>
					)}
					<p className="section-note">
						Replacing this workspace removes its comparison snapshot. Download
						your current plan before continuing.
					</p>
					<div className="modal-actions">
						<button
							type="button"
							className="button secondary"
							onClick={exportPlan}
						>
							<Download size={16} />
							Export current plan
						</button>
						<button
							type="button"
							className="button primary"
							disabled={hasDraft}
							onClick={applyPlan}
						>
							Replace workspace
						</button>
					</div>
				</Modal>
			)}
			{serverCandidate && (
				<ModelImportPreview
					document={serverCandidate}
					eyebrow="The current server model remains unchanged"
					onClose={closePreview}
					footer={
						<>
							<button
								type="button"
								className="button secondary"
								onClick={exportPlan}
							>
								<Download size={16} />
								Export current server model
							</button>
							<button
								type="button"
								className="button primary"
								disabled={importing || readOnly || hasDraft || !canImportServer}
								onClick={() => {
									void importServerModel();
								}}
							>
								{importing ? "Importing…" : "Import to server"}
							</button>
						</>
					}
				>
					<div className="inline-notice">
						<LockKeyhole size={18} />
						<span>
							The server validates the canonical accounts, checkpoints,
							postings, and evaluations before activation. The file is sent only
							after you confirm.
						</span>
					</div>
					{hasDraft && (
						<div className="inline-notice amber">
							<TriangleAlert size={18} />
							Save or discard your temporary version before replacing the server
							model. The local recovery backup is available now.
						</div>
					)}
					{!canImportServer && (
						<div className="inline-notice amber">
							<TriangleAlert size={18} />
							Server model import is unavailable in this view. Use the server
							recovery importer to restore a model.
						</div>
					)}
				</ModelImportPreview>
			)}
		</>
	);
}
