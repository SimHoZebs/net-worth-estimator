import { useServerModel, useServerStatus } from "./workspaceResources.ts";
import {
	draftConflict,
	selectDraftChangeCount,
	useWorkspaceStore,
} from "./workspaceStore.ts";
import { useWorkspaceWriteError } from "./workspaceWrites.ts";
import { ApiHttpError } from "../api/index.ts";

export function usePlan() {
	const draft = useWorkspaceStore((state) => state.draft);
	const model = useServerModel();
	return model.data?.conversion ? (draft ?? model.data.conversion.plan) : null;
}
export function useWorkspaceReadOnly() {
	const model = useServerModel();
	const status = useServerStatus();
	const error = useWorkspaceWriteError();
	return Boolean(
		(status.data?.readOnly ?? true) ||
		model.data?.conversion?.plan.readOnly ||
		(error instanceof ApiHttpError && error.status === 403),
	);
}
export function useDraftChangeCount() {
	return useWorkspaceStore(selectDraftChangeCount);
}
export function useDraftConflict() {
	const model = useServerModel();
	const draft = useWorkspaceStore((state) => state.draft);
	const baseFingerprint = useWorkspaceStore((state) => state.baseFingerprint);
	const baseRevision = useWorkspaceStore((state) => state.baseRevision);
	const baseline = useWorkspaceStore((state) => state.baseline);
	return draftConflict(
		{
			...useWorkspaceStore.getState(),
			draft,
			baseFingerprint,
			baseRevision,
			baseline,
		},
		model.data,
	);
}
