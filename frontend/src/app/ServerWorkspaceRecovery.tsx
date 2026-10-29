import { FileUp, LockKeyhole, RotateCcw } from "lucide-react";
import { type ReactNode, type RefObject, useRef } from "react";
import type { FinancialModelDocument } from "../api/index.ts";
import { parseModelDocument } from "../api/modelImport.ts";
import { Button } from "../components/Button.tsx";
import { Notice } from "../components/Notice.tsx";
import { ModelImportPreview } from "../components/imports/ModelImportPreview.tsx";
import { dismissKey, notifyError } from "../state/notifications.ts";
import { useFileReview } from "../state/useFileReview.ts";
import { useServerModelImport } from "../state/useServerModelImport.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import {
	reloadWorkspace,
	useServerModel,
	useServerStatus,
} from "../state/workspaceResources.ts";
import { importServerDocument } from "../state/workspaceWrites.ts";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { WorkspaceTopbar } from "../workspace/WorkspaceHeader.tsx";
import { WorkspaceLayout } from "../workspace/WorkspaceLayout.tsx";
import { WorkspaceSidebar } from "../workspace/WorkspaceSidebar.tsx";

export function ServerWorkspaceRecovery() {
	// Terminal load states subscribe everything they display, including the
	// model import flow and access control.
	const status = useServerStatus().data;
	const serverDocument = useServerModel().data?.document;
	const readOnly = useUserReadOnly();
	const retry = reloadWorkspace;
	const { importDocument } = useServerModelImport({
		preconditions: {
			hasWorkspace: false,
			readOnly,
			hasDraft: false,
			loading: false,
		},
		recover: importServerDocument,
		reload: retry,
	});
	const { candidate, reading, readFile, clearCandidate } =
		useFileReview<FinancialModelDocument>({
			parse: (text) =>
				parseModelDocument({
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
	const missingModel = status !== undefined && serverDocument === null;
	const importCandidate = async () => {
		if (!candidate || readOnly) return;
		clearCandidate();
		dismissKey("model-import");
		const imported = await importDocument(candidate);
		if (!imported)
			failImport(
				"The server did not activate this model. Review the recovery message before trying again.",
			);
	};
	return (
		<>
			<ServerRecovery
				title={
					missingModel
						? "No financial model is stored on this server"
						: "Your account workspace needs attention"
				}
				onRetry={() => {
					void retry();
				}}
			>
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
			</ServerRecovery>
			{candidate && (
				<ModelImportPreview
					document={candidate}
					eyebrow="The server has no active model"
					onClose={clearCandidate}
					footer={
						<>
							<Button onClick={clearCandidate}>Cancel</Button>
							<Button
								variant="primary"
								onClick={() => {
									void importCandidate();
								}}
							>
								Import to server
							</Button>
						</>
					}
				>
					<Notice>
						<LockKeyhole size={18} />
						<span>
							Validated before activation. Nothing is sent until you confirm.
						</span>
					</Notice>
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
			<Button
				variant="primary"
				onClick={onChoose}
				disabled={readOnly || reading}
			>
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

function ServerRecovery({
	title,
	onRetry,
	children,
}: {
	title: string;
	onRetry: () => void;
	children?: ReactNode;
}) {
	const navigation = useWorkspaceNavigation();
	return (
		<WorkspaceLayout
			navigation={(close) => (
				<WorkspaceSidebar page={navigation.page} onClose={close} />
			)}
			header={(open) => (
				<WorkspaceTopbar
					page={navigation.currentPage}
					onOpenNavigation={open}
				/>
			)}
			draftBar={null}
			overlays={null}
		>
			<div className="mx-auto my-[12vh] max-w-2xl p-6 [&_p]:mb-6">
				<h1 className="mb-6">{title}.</h1>
				{children}
				<div className="flex flex-wrap gap-3">
					<Button onClick={onRetry}>
						<RotateCcw size={15} />
						Retry server load
					</Button>
				</div>
			</div>
		</WorkspaceLayout>
	);
}
