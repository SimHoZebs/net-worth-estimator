import { Download, LockKeyhole, TriangleAlert } from "lucide-react";
import { ModelImportPreview } from "../../components/imports/ModelImportPreview.tsx";
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
		| "candidate"
		| "closePreview"
		| "exportServerModel"
		| "importing"
		| "importServerModel"
	>;
}) {
	const {
		candidate,
		closePreview,
		exportServerModel,
		importing,
		importServerModel,
	} = controller;
	if (!candidate) return null;
	return (
		<ModelImportPreview
			document={candidate}
			eyebrow="The current server model remains unchanged"
			onClose={closePreview}
			footer={
				<>
					<button
						type="button"
						className="button secondary"
						onClick={exportServerModel}
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
					Validated before activation. Nothing is sent until you confirm.
				</span>
			</div>
			{hasDraft && (
				<div className="inline-notice amber">
					<TriangleAlert size={18} />
					Save or discard your unsaved changes before replacing the saved model.
				</div>
			)}
			{!canImportServer && (
				<div className="inline-notice amber">
					<TriangleAlert size={18} />
					Import is unavailable in this view. Use the recovery importer to
					restore a model.
				</div>
			)}
		</ModelImportPreview>
	);
}
