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
					The server validates the canonical accounts, checkpoints, postings,
					and evaluations before activation. The file is sent only after you
					confirm.
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
	);
}
