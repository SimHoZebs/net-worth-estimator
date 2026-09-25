import { FileJson, FileUp, LockKeyhole, RotateCcw } from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ApiHttpError,
	createApiClient,
	type FinancialModelDocument,
} from "./api/index.ts";
import { ErrorNotice, Modal } from "./components/ui.tsx";
import { examplePlan } from "./domain/example.ts";
import { project } from "./domain/projection.ts";
import { download, readStoredWorkspace } from "./state/storage.ts";
import { useProjection } from "./state/useProjection.ts";
import { useRemoteProjection } from "./state/useRemoteProjection.ts";
import { useRemoteWorkspace } from "./state/useRemoteWorkspace.ts";
import { useWorkspace } from "./state/useWorkspace.ts";
import { WorkspaceShell } from "./WorkspaceShell.tsx";

const runtimeMode =
	import.meta.env.VITE_WAYPOINT_MODE === "fixture" ? "fixture" : "server";

export default function App() {
	return runtimeMode === "fixture" ? <FixtureApp /> : <ServerApp />;
}

function FixtureApp() {
	const state = useWorkspace();
	const [recoveryError, setRecoveryError] = useState<string | null>(null);
	const [years, setYears] = useState(20);
	const [ranges, setRanges] = useState(true);
	if (!state.workspace || !state.plan)
		return (
			<FixtureRecovery
				error={recoveryError ?? state.error}
				onDownload={() => {
					const stored = readStoredWorkspace();
					if (stored instanceof Error) {
						setRecoveryError(stored.message);
						return;
					}
					if (stored === null) {
						setRecoveryError(
							"No stored record is available to download. Retry loading the workspace.",
						);
						return;
					}
					download({ name: "waypoint-stored-recovery.json", content: stored });
				}}
				onExample={() => state.replace(structuredClone(examplePlan))}
			/>
		);
	return (
		<FixtureWorkspace
			state={state}
			years={years}
			setYears={setYears}
			ranges={ranges}
			setRanges={setRanges}
		/>
	);
}

function FixtureWorkspace({
	state,
	years,
	setYears,
	ranges,
	setRanges,
}: {
	state: ReturnType<typeof useWorkspace>;
	years: number;
	setYears: (years: number) => void;
	ranges: boolean;
	setRanges: (ranges: boolean) => void;
}) {
	const plan = state.plan!;
	const workspace = state.workspace!;
	const localProjection = useProjection({ plan, years, ranges });
	const savedProjection = useMemo(
		() => project({ plan: workspace.saved, years }),
		[workspace.saved, years],
	);
	const projection = {
		...localProjection,
		loading: false,
		retryProjection: () => window.location.reload(),
	};
	return (
		<WorkspaceShell
			workspace={workspace}
			plan={plan}
			state={state}
			projection={projection}
			savedProjection={savedProjection}
			years={years}
			setYears={setYears}
			ranges={ranges}
			setRanges={setRanges}
			retrySavedProjection={() => window.location.reload()}
		/>
	);
}

function ServerApp() {
	const [years, setYears] = useState(20);
	const [ranges, setRanges] = useState(true);
	const [authToken, setAuthToken] = useState("");
	const [candidate, setCandidate] = useState<FinancialModelDocument | null>(
		null,
	);
	const [importError, setImportError] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const [importing, setImporting] = useState(false);
	const importInput = useRef<HTMLInputElement>(null);
	const serverApi = useMemo(() => createApiClient(), []);
	const remote = useRemoteWorkspace({ authToken, client: serverApi });
	const projection = useRemoteProjection({
		document: remote.serverDocument,
		draftDocument: remote.draftDocument,
		years,
		ranges,
		authToken,
		incomeData: remote.incomeData,
	});
	const savedProjection = useRemoteProjection({
		document: remote.serverDocument,
		draftDocument: null,
		years,
		ranges: false,
		authToken,
		incomeData: remote.incomeData,
	});
	const retryRemote = remote.retry;

	useEffect(() => {
		if (authToken) void retryRemote();
	}, [authToken, retryRemote]);

	const authControl = authToken ? (
		<div className="inline-notice auth-notice">
			<LockKeyhole size={18} aria-hidden="true" />
			<span>
				<strong>Server access token ready.</strong> It stays in this tab’s
				memory and is cleared when this page closes.
			</span>
			<button
				type="button"
				className="text-button"
				onClick={() => setAuthToken("")}
			>
				Clear token
			</button>
		</div>
	) : remote.authRequired ? (
		<RemoteAuthPrompt onApply={setAuthToken} />
	) : null;

	const readServerFile = async (file: File) => {
		setImportError(null);
		if (file.size > 2_000_000) {
			setImportError(
				"The model file is larger than 2 MB. Choose a smaller JSON file.",
			);
			return;
		}
		setReading(true);
		try {
			const text = await file.text();
			const value: unknown = JSON.parse(text);
			if (!isFinancialModelDocument(value)) {
				setImportError(
					"Choose a Waypoint server model JSON file with accounts, checkpoints, postings, and evaluations.",
				);
				return;
			}
			setCandidate(value);
		} catch {
			setImportError("The selected model file is not valid JSON.");
		} finally {
			setReading(false);
		}
	};

	const importCandidate = async () => {
		if (!candidate || remote.readOnly) return;
		setCandidate(null);
		setImportError(null);
		setImporting(true);
		const imported = await remote.importServerDocument(candidate);
		if (!imported)
			setImportError(
				"The server did not activate this model. Review the recovery message before trying again.",
			);
		setImporting(false);
	};

	const importServerDocument = async (document: FinancialModelDocument) => {
		setImporting(true);
		try {
			if (!remote.workspace) return await remote.importServerDocument(document);
			if (remote.readOnly)
				throw new Error(
					"The server is read-only. The selected model was not uploaded.",
				);
			if (remote.workspace.draft)
				throw new Error(
					"Save or discard your temporary server plan before importing another model.",
				);
			if (remote.loading)
				throw new Error(
					"Wait for the current server operation to finish before importing a model.",
				);
			if (!remote.serverRevision)
				throw new Error(
					"The server did not provide a model content identity. Reload the current model before importing.",
				);
			const result = await serverApi.putModel(document, {
				authToken,
				ifMatch: remote.serverRevision,
			});
			if (result instanceof Error) {
				if (result instanceof ApiHttpError && result.status === 412) {
					await remote.retry();
					throw new Error(
						"The server model changed while this import was being reviewed. The latest model has been loaded; review it before importing again.",
					);
				}
				throw result;
			}
			const validationErrors = result.issues.filter(
				(issue) => issue.severity === "error",
			);
			if (validationErrors.length) {
				const details = validationErrors
					.map((issue) => issue.message)
					.filter(Boolean)
					.join(" ");
				throw new Error(
					`The server rejected this model${details ? `: ${details}` : "."}`,
				);
			}
			await remote.retry();
			return true;
		} finally {
			setImporting(false);
		}
	};

	if (!remote.workspace || !remote.plan) {
		const missingModel =
			remote.status !== null &&
			remote.serverDocument === null &&
			!remote.loading;
		const showRecoveryDraft = !remote.loading && Boolean(remote.recoveryDraft);
		return (
			<>
				{remote.loading || importing ? (
					<ServerRecovery
						title={
							importing
								? "Importing your server model"
								: "Connecting to your Waypoint server"
						}
						loading
						onRetry={() => {
							void remote.retry();
						}}
					/>
				) : (
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
						{missingModel && (
							<p>
								Import a reviewed server model JSON file to continue. Any
								browser draft remains available for recovery after a model is
								loaded. No example data has been substituted.
							</p>
						)}
						{showRecoveryDraft && remote.recoveryDraft && (
							<div className="inline-notice">
								<FileJson size={18} />
								<span>
									A browser draft is available for recovery. Export it before
									retrying the server connection; it will not be uploaded
									automatically.
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
								error={importError}
								inputRef={importInput}
								onChoose={() => importInput.current?.click()}
								onFile={(file) => {
									void readServerFile(file);
								}}
							/>
						)}
					</ServerRecovery>
				)}
				{candidate && (
					<Modal
						title="Review server model import"
						eyebrow="The server has no active model"
						onClose={() => setCandidate(null)}
					>
						<div className="import-summary">
							<FileJson size={30} />
							<h3>
								{candidate.sourcePath.split("/").filter(Boolean).at(-1) ||
									"Waypoint model"}
							</h3>
							<p>
								{candidate.accounts.length} accounts ·{" "}
								{candidate.postings.length} postings ·{" "}
								{candidate.checkpoints.length} checkpoints
							</p>
							<p>
								{candidate.evaluations.financialIndependence.length +
									candidate.evaluations.netWorthThreshold.length +
									candidate.evaluations.postingFulfillment.length}{" "}
								evaluations
							</p>
						</div>
						<div className="inline-notice">
							<LockKeyhole size={18} />
							<span>
								The server validates this document before making it active. The
								file is sent only after you confirm.
							</span>
						</div>
						<div className="modal-actions">
							<button
								type="button"
								className="button secondary"
								onClick={() => setCandidate(null)}
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
						</div>
					</Modal>
				)}
			</>
		);
	}

	return (
		<WorkspaceShell
			workspace={remote.workspace}
			plan={remote.plan}
			state={remote}
			projection={projection}
			savedProjection={savedProjection.base}
			years={years}
			setYears={setYears}
			ranges={ranges}
			setRanges={setRanges}
			serverMode
			serverStatus={remote.status}
			serverDocument={remote.serverDocument}
			onImportServerDocument={importServerDocument}
			readOnly={remote.readOnly}
			authRequired={remote.authRequired}
			authTokenActive={Boolean(authToken)}
			authControl={authControl}
			loading={remote.loading || importing}
			retrySavedProjection={savedProjection.retryProjection}
		/>
	);
}

function RemoteAuthPrompt({ onApply }: { onApply: (token: string) => void }) {
	const [token, setToken] = useState("");
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const next = token.trim();
		if (next) onApply(next);
	};
	return (
		<div className="inline-notice auth-notice">
			<LockKeyhole size={18} aria-hidden="true" />
			<span>
				<strong>Server authentication required.</strong> Enter the bearer token
				to enable protected saves. It stays in React memory only and is never
				stored or added to the URL.
			</span>
			<form className="auth-form" onSubmit={submit}>
				<label className="sr-only" htmlFor="waypoint-server-token">
					Server bearer token
				</label>
				<input
					id="waypoint-server-token"
					type="password"
					value={token}
					onChange={(event) => setToken(event.target.value)}
					autoComplete="off"
					spellCheck={false}
					required
				/>
				<button type="submit" className="button primary small">
					Use token
				</button>
			</form>
		</div>
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
	loading = false,
	onRetry,
	children,
}: {
	title: string;
	loading?: boolean;
	onRetry?: () => void;
	children?: ReactNode;
}) {
	return (
		<div className="recovery-screen">
			<Brand />
			<h1>{title}.</h1>
			{loading ? (
				<>
					<div className="recovery-progress" role="status">
						<span className="spinner" aria-hidden="true" />
						Loading the saved model, status, and income snapshot.
					</div>
					<p>No example data will be substituted.</p>
					<div className="recovery-actions">
						<button
							type="button"
							className="button secondary"
							onClick={onRetry}
						>
							Retry server load
						</button>
					</div>
				</>
			) : (
				<>
					{children}
					<div className="recovery-actions">
						<button
							type="button"
							className="button secondary"
							onClick={onRetry}
						>
							<RotateCcw size={15} />
							Retry server load
						</button>
					</div>
				</>
			)}
		</div>
	);
}

function FixtureRecovery({
	error,
	onDownload,
	onExample,
}: {
	error: string | null;
	onDownload: () => void;
	onExample: () => void;
}) {
	return (
		<div className="recovery-screen">
			<Brand />
			<h1>Your saved work needs attention.</h1>
			<ErrorNotice
				message={error ?? "The workspace could not be read."}
				action="Retry loading"
				onAction={() => window.location.reload()}
			/>
			<p>
				No example data has been substituted. Your existing browser record has
				not been changed.
			</p>
			<div className="recovery-actions">
				<button type="button" className="button primary" onClick={onDownload}>
					Download stored record
				</button>
				<button type="button" className="button secondary" onClick={onExample}>
					Explicitly replace with an example plan
				</button>
			</div>
		</div>
	);
}

function Brand() {
	return (
		<a className="brand" href="#outlook" aria-label="Waypoint home">
			<span className="brand-mark">
				<svg viewBox="0 0 32 32" aria-hidden="true">
					<path d="m5 23 6-15 6 12 5-9 5 12" />
				</svg>
			</span>
			<span>
				waypoint<span className="brand-period">.</span>
			</span>
		</a>
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvaluationTables(value: unknown): boolean {
	return (
		isRecord(value) &&
		Array.isArray(value.financialIndependence) &&
		Array.isArray(value.netWorthThreshold) &&
		Array.isArray(value.postingFulfillment)
	);
}

function isFinancialModelDocument(
	value: unknown,
): value is FinancialModelDocument {
	if (
		!isRecord(value) ||
		typeof value.sourcePath !== "string" ||
		!isEvaluationTables(value.evaluations)
	)
		return false;
	if (
		!Array.isArray(value.accounts) ||
		!Array.isArray(value.checkpoints) ||
		!Array.isArray(value.postings)
	)
		return false;
	const accountsValid = value.accounts.every(
		(item) =>
			isRecord(item) &&
			typeof item.id === "string" &&
			typeof item.label === "string" &&
			typeof item.enabled === "boolean",
	);
	const checkpointsValid = value.checkpoints.every(
		(item) =>
			isRecord(item) &&
			typeof item.Date === "string" &&
			typeof item.AccountId === "string" &&
			typeof item.Balance === "number",
	);
	const postingsValid = value.postings.every(
		(item) =>
			isRecord(item) &&
			typeof item.id === "string" &&
			typeof item.label === "string" &&
			typeof item.enabled === "boolean",
	);
	return accountsValid && checkpointsValid && postingsValid;
}
