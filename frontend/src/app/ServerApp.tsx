import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "../api/index.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useRemoteWorkspace } from "../state/useRemoteWorkspace.ts";
import { useServerModelImport } from "../state/useServerModelImport.ts";
import { WorkspaceShell } from "../WorkspaceShell.tsx";
import { RemoteAuthControl } from "./RemoteAuthControl.tsx";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

export function ServerApp() {
	const [years, setYears] = useState(20);
	const [ranges, setRanges] = useState(true);
	const [authToken, setAuthToken] = useState("");
	const serverApi = useMemo(() => createApiClient(), []);
	const remote = useRemoteWorkspace({ authToken, client: serverApi });
	const { importing, importDocument } = useServerModelImport({
		client: serverApi,
		authToken,
		preconditions: {
			hasWorkspace: Boolean(remote.workspace),
			readOnly: remote.readOnly,
			hasDraft: Boolean(remote.workspace?.draft),
			loading: remote.loading,
			revision: remote.serverRevision,
		},
		recover: remote.importServerDocument,
		reload: remote.retry,
	});
	const projection = useRemoteProjection({
		document: remote.serverDocument,
		draftDocument: remote.draftDocument,
		years,
		ranges,
		authToken,
		incomeData: remote.incomeData,
	});
	// The saved-plan projection is only needed to compare against a draft.
	// With no draft the active projection already is the saved one, so the
	// second run is skipped rather than computing the same projection twice.
	const hasDraft = Boolean(remote.draftDocument);
	const saved = useRemoteProjection({
		document: remote.serverDocument,
		draftDocument: null,
		years,
		ranges: false,
		authToken,
		incomeData: remote.incomeData,
		enabled: hasDraft,
	});
	const savedProjection = hasDraft ? saved.base : projection.base;
	const retrySavedProjection = hasDraft
		? saved.retryProjection
		: projection.retryProjection;
	const retryRemote = remote.retry;
	useEffect(() => {
		if (authToken) void retryRemote();
	}, [authToken, retryRemote]);
	const authControl = (
		<RemoteAuthControl
			tokenActive={Boolean(authToken)}
			required={remote.authRequired}
			onApply={setAuthToken}
			onClear={() => setAuthToken("")}
		/>
	);

	if (!remote.workspace || !remote.plan)
		return (
			<ServerWorkspaceRecovery
				remote={remote}
				importing={importing}
				authControl={authControl}
				onImport={importDocument}
			/>
		);
	return (
		<WorkspaceShell
			workspace={remote.workspace}
			plan={remote.plan}
			state={remote}
			projection={projection}
			savedProjection={savedProjection}
			years={years}
			setYears={setYears}
			ranges={ranges}
			setRanges={setRanges}
			serverStatus={remote.status}
			serverDocument={remote.serverDocument}
			onImportServerDocument={importDocument}
			readOnly={remote.readOnly}
			authRequired={remote.authRequired}
			authTokenActive={Boolean(authToken)}
			authControl={authControl}
			loading={remote.loading || importing}
			retrySavedProjection={retrySavedProjection}
		/>
	);
}
