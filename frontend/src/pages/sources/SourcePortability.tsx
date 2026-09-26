import { Download, FileJson, FileUp } from "lucide-react";
import type { ModelImportController } from "../../state/useModelImport.ts";

export function SourcePortability({
	serverMode,
	hasDraft,
	hasServerDocument,
	canImportServer,
	readOnly,
	controller,
}: {
	serverMode: boolean;
	hasDraft: boolean;
	hasServerDocument: boolean;
	canImportServer: boolean;
	readOnly: boolean;
	controller: Pick<
		ModelImportController,
		| "exportPlan"
		| "exportWorkspace"
		| "inputRef"
		| "onFile"
		| "reading"
		| "importing"
	>;
}) {
	const { exportPlan, exportWorkspace, inputRef, onFile, reading, importing } =
		controller;
	return (
		<section className="panel portability">
			<h2>
				{serverMode
					? "Server model and local recovery"
					: "Your data, on your terms"}
			</h2>
			<p>
				{serverMode
					? "Export the canonical server document. Browser drafts and workspace backups remain local recovery copies."
					: "Download a plan for safekeeping, or review a new one before replacing this workspace."}
			</p>
			<button
				type="button"
				className="portability-action"
				onClick={exportPlan}
				disabled={serverMode && !hasServerDocument}
			>
				<Download size={21} />
				<span>
					<strong>
						{serverMode
							? "Export server model"
							: `Export ${hasDraft ? "temporary" : "saved"} plan`}
					</strong>
					<small>
						{serverMode
							? "Canonical FinancialModelDocument JSON"
							: "Portable JSON · includes all plan records"}
					</small>
				</span>
				<span>↗</span>
			</button>
			<button
				type="button"
				className="portability-action"
				onClick={() => inputRef.current?.click()}
				disabled={
					reading || importing || (serverMode && (readOnly || !canImportServer))
				}
			>
				<FileUp size={21} />
				<span>
					<strong>
						{reading
							? "Reading your file…"
							: importing
								? "Importing model…"
								: serverMode
									? "Import server model"
									: "Import a plan"}
					</strong>
					<small>
						{serverMode
							? "Server model JSON · maximum 2 MB · explicit review before upload"
							: "Waypoint JSON · maximum 2 MB · reviewed before applying"}
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
				{serverMode
					? "Download local recovery backup"
					: "Download full workspace backup"}
			</button>
			<small className="muted">
				{serverMode
					? "Local recovery includes the display draft and comparison measures; it is not the canonical server model."
					: "Workspace backups include the saved plan, draft, and comparison measures. To import a plan, use a plan export."}
			</small>
			<input
				className="sr-only"
				ref={inputRef}
				type="file"
				accept=".json,application/json"
				aria-label={
					serverMode ? "Import Waypoint server model" : "Import Waypoint plan"
				}
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void onFile(file);
					event.target.value = "";
				}}
			/>
		</section>
	);
}
