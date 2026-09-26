import { Download, FileJson, FileUp } from "lucide-react";
import type { ModelImportController } from "../../state/useModelImport.ts";

export function SourcePortability({
	hasServerDocument,
	canImportServer,
	readOnly,
	controller,
}: {
	hasServerDocument: boolean;
	canImportServer: boolean;
	readOnly: boolean;
	controller: Pick<
		ModelImportController,
		| "exportServerModel"
		| "exportWorkspace"
		| "inputRef"
		| "onFile"
		| "reading"
		| "importing"
	>;
}) {
	const {
		exportServerModel,
		exportWorkspace,
		inputRef,
		onFile,
		reading,
		importing,
	} = controller;
	return (
		<section className="panel portability">
			<h2>"Server model and local recovery"</h2>
			<p>
				"Export the canonical server document. Browser drafts and workspace
				backups remain local recovery copies."
			</p>
			<button
				type="button"
				className="portability-action"
				onClick={exportServerModel}
				disabled={!hasServerDocument}
			>
				<Download size={21} />
				<span>
					<strong>"Export server model"</strong>
					<small>"Canonical FinancialModelDocument JSON"</small>
				</span>
				<span>↗</span>
			</button>
			<button
				type="button"
				className="portability-action"
				onClick={() => inputRef.current?.click()}
				disabled={reading || importing || readOnly || !canImportServer}
			>
				<FileUp size={21} />
				<span>
					<strong>
						{reading
							? "Reading your file…"
							: importing
								? "Importing model…"
								: "Import server model"}
					</strong>
					<small>
						"Server model JSON · maximum 2 MB · explicit review before upload"
					</small>
				</span>
				<span>↗</span>
			</button>
			<button
				type="button"
				className="text-button backup-button"
				onClick={exportWorkspace}
			>
				<FileJson size={15} />
				"Download local recovery backup"
			</button>
			<small className="muted">
				"Local recovery includes the display draft and comparison measures; it
				is not the canonical server model."
			</small>
			<input
				className="sr-only"
				ref={inputRef}
				type="file"
				accept=".json,application/json"
				aria-label={"Import Waypoint server model"}
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void onFile(file);
					event.target.value = "";
				}}
			/>
		</section>
	);
}
