import { FileJson, FileUp, LockKeyhole, RotateCcw } from "lucide-react";
import { type ReactNode, type RefObject, useRef } from "react";
import type { FinancialModelDocument } from "../api/index.ts";
import { parseModelDocument } from "../api/modelImport.ts";
import { Brand } from "../components/Brand.tsx";
import { ModelImportPreview } from "../components/imports/ModelImportPreview.tsx";
import { ErrorNotice } from "../components/ui.tsx";
import { download } from "../state/storage.ts";
import { useFileReview } from "../state/useFileReview.ts";
import type { useRemoteWorkspace } from "../state/useRemoteWorkspace.ts";

export function ServerWorkspaceRecovery({
	remote,
	authControl,
	onImport,
}: {
	remote: ReturnType<typeof useRemoteWorkspace>;
	authControl: ReactNode;
	onImport: (document: FinancialModelDocument) => Promise<boolean>;
}) {
	const { candidate, error, reading, setError, readFile, clearCandidate } =
		useFileReview<FinancialModelDocument>({
			parse: (text) =>
				parseModelDocument({
					text,
					malformedMessage: "The selected model file is not valid JSON.",
				}),
			oversizedMessage:
				"The model file is larger than 2 MB. Choose a smaller JSON file.",
		});
	const inputRef = useRef<HTMLInputElement>(null);
	const missingModel = remote.status !== null && remote.serverDocument === null;
	const showRecoveryDraft = Boolean(remote.recoveryDraft);
	const importCandidate = async () => {
		if (!candidate || remote.readOnly) return;
		clearCandidate();
		setError(null);
		const imported = await onImport(candidate);
		if (!imported)
			setError(
				"The server did not activate this model. Review the recovery message before trying again.",
			);
	};
	return (
		<>
			<ServerRecovery
				title={
					missingModel
						? "No financial model is stored on this server"
						: "Your server workspace needs attention"
				}
				onRetry={() => {
					void remote.retry();
				}}
			>
				{!remote.error?.includes("no financial model") && (
					<ErrorNotice
						message={
							remote.error ?? "The server workspace could not be loaded."
						}
						action="Retry server load"
						onAction={() => {
							void remote.retry();
						}}
					/>
				)}
				{missingModel && <p>Import a reviewed model JSON file to continue.</p>}
				{showRecoveryDraft && remote.recoveryDraft && (
					<div className="inline-notice">
						<FileJson size={18} />
						<span>
							A draft is available for recovery. Export it before retrying; it
							will not be uploaded automatically.
						</span>
						<button
							type="button"
							className="text-button"
							onClick={() =>
								download({
									name: "waypoint-remote-draft-recovery.json",
									content: JSON.stringify(remote.recoveryDraft, null, 2),
								})
							}
						>
							Export browser draft
						</button>
					</div>
				)}
				{authControl}
				{missingModel && (
					<ServerModelImport
						readOnly={remote.readOnly}
						reading={reading}
						error={error}
						inputRef={inputRef}
						onChoose={() => inputRef.current?.click()}
						onFile={(file) => {
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
							<button
								type="button"
								className="button secondary"
								onClick={clearCandidate}
							>
								Cancel
							</button>
							<button
								type="button"
								className="button primary"
								onClick={() => {
									void importCandidate();
								}}
							>
								Import to server
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
				</ModelImportPreview>
			)}
		</>
	);
}

function ServerModelImport({
	readOnly,
	reading,
	error,
	inputRef,
	onChoose,
	onFile,
}: {
	readOnly: boolean;
	reading: boolean;
	error: string | null;
	inputRef: RefObject<HTMLInputElement | null>;
	onChoose: () => void;
	onFile: (file: File) => void;
}) {
	return (
		<div className="server-import">
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
			{error && <ErrorNotice message={error} />}
			<button
				type="button"
				className="button primary"
				onClick={onChoose}
				disabled={readOnly || reading}
			>
				<FileUp size={17} />
				{reading ? "Reading model…" : "Choose server model JSON"}
			</button>
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
	return (
		<div className="recovery-screen">
			<Brand />
			<h1>{title}.</h1>
			{children}
			<div className="recovery-actions">
				<button type="button" className="button secondary" onClick={onRetry}>
					<RotateCcw size={15} />
					Retry server load
				</button>
			</div>
		</div>
	);
}
