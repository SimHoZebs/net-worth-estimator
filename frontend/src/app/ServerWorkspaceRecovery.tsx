import { FileUp, LockKeyhole, RotateCcw } from "lucide-react";
import { type RefObject, useRef } from "react";
import { dismissKey, notifyError } from "../state/notifications.ts";
import type { FinancialModel } from "../api/index.ts";
import { parseFinancialModel } from "../api/modelImport.ts";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { ModelImportPreview } from "../components/imports/ModelImportPreview.tsx";
import { useFileReview } from "../state/useFileReview.ts";
import { useServerModelImport } from "../state/useServerModelImport.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import {
	reloadWorkspace,
	useServerStatus,
} from "../state/workspaceResources.ts";
import { importServerModel } from "../state/workspaceWrites.ts";

// Recovery body for when the server holds no model. Renders inside the
// single workspace layout owned by ServerApp, so navigation stays
// mounted across the recovery boundary.
export function ServerWorkspaceRecovery() {
	// Terminal load states subscribe everything they display, including the
	// model import flow and access control.
	const status = useServerStatus().data;
	const readOnly = useUserReadOnly();
	const retry = reloadWorkspace;
	const { importModel } = useServerModelImport({
		preconditions: {
			hasWorkspace: false,
			readOnly,
			loading: false,
		},
		recover: importServerModel,
		reload: async () => {
			await retry();
		},
	});
	const { candidate, reading, readFile, clearCandidate } =
		useFileReview<FinancialModel>({
			parse: (text) =>
				parseFinancialModel({
					text,
					malformedMessage: "The selected model file is not valid JSON.",
				}),
			oversizedMessage:
				"The model file is larger than 2 MB. Choose a smaller JSON file.",
			onError: (message) => notifyError("model-import", message),
		});
	const inputRef = useRef<HTMLInputElement>(null);
	const failImport = (message: string) => {
		notifyError("model-import", message);
	};
	const missingModel = status !== undefined && status.hasModel === false;
	const importCandidate = async () => {
		if (!candidate || readOnly) return;
		clearCandidate();
		dismissKey("model-import");
		const imported = await importModel(candidate);
		if (!imported)
			failImport(
				"The server did not activate this model. Review the recovery message before trying again.",
			);
	};
	return (
		<>
			<div className="mx-auto my-[12vh] max-w-2xl p-6 [&_p]:mb-6">
				<h1 className="mb-6">
					{missingModel
						? "No financial model is stored on this server."
						: "Your workspace needs attention."}
				</h1>
				{missingModel && <p>Import a reviewed model JSON file to continue.</p>}
				{missingModel && (
					<ServerModelImport
						readOnly={readOnly}
						reading={reading}
						inputRef={inputRef}
						onChoose={() => inputRef.current?.click()}
						onFile={(file) => {
							dismissKey("model-import");
							void readFile(file);
						}}
					/>
				)}
				<div className="flex flex-wrap gap-3">
					<Button
						variant="secondary"
						onClick={() => {
							void retry();
						}}
					>
						<RotateCcw size={15} />
						Retry server load
					</Button>
				</div>
			</div>
			{candidate && (
				<ModelImportPreview
					model={candidate}
					eyebrow="The server has no active model"
					onClose={clearCandidate}
					footer={
						<>
							<Button variant="secondary" onClick={clearCandidate}>
								Cancel
							</Button>
							<Button
								onClick={() => {
									void importCandidate();
								}}
							>
								Import to server
							</Button>
						</>
					}
				>
					<Alert>
						<LockKeyhole size={18} />
						<AlertDescription>
							Validated before activation. Nothing is sent until you confirm.
						</AlertDescription>
					</Alert>
				</ModelImportPreview>
			)}
		</>
	);
}

function ServerModelImport({
	readOnly,
	reading,
	inputRef,
	onChoose,
	onFile,
}: {
	readOnly: boolean;
	reading: boolean;
	inputRef: RefObject<HTMLInputElement | null>;
	onChoose: () => void;
	onFile: (file: File) => void;
}) {
	return (
		<div className="mt-6 flex flex-col items-center gap-3">
			<input
				ref={inputRef}
				className="sr-only"
				type="file"
				accept="application/json,.json"
				aria-label="Import Waypoint server model"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) onFile(file);
				}}
			/>
			<Button onClick={onChoose} disabled={readOnly || reading}>
				<FileUp size={17} />
				{reading ? "Reading model…" : "Choose server model JSON"}
			</Button>
			<small>
				{readOnly
					? "This server is read-only and cannot accept an import."
					: "Maximum 2 MB · explicit review before upload"}
			</small>
		</div>
	);
}
