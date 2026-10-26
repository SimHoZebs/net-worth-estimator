import { useIsMutating, useMutationState } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	createAmountPreset,
	deleteAmountPreset,
	moveAmountPreset,
	updateAmountPreset,
} from "@/api/generated/endpoints.ts";
import {
	applyRowOperations,
	diffFinancialModelDocuments,
} from "@/api/rowSync.ts";
import {
	ApiHttpError,
	type AmountPreset,
	type FinancialModelDocument,
	READ_ONLY_IMPORT_MESSAGE,
} from "@/api/index.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "@/auth/resourceScope.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import {
	getServerModel,
	getServerStatus,
	modelOptions,
	presetsOptions,
	reloadWorkspace,
	workspaceResourceKey,
} from "@/state/workspaceResources.ts";
import {
	draftDocumentForSave,
	useWorkspaceStore,
} from "@/state/workspaceStore.ts";
import {
	dismissKey,
	notifyError,
	notifySuccess,
} from "@/state/notifications.ts";

export function workspaceWriteKey(kind: "model" | "presets") {
	return ["workspace-write", getResourceScope().key, kind] as const;
}

async function write<T>(
	kind: "model" | "presets",
	perform: () => Promise<T>,
): Promise<T | false> {
	const scope = getResourceScope();
	const cache = serverQueryClient();
	const key = workspaceWriteKey(kind);
	if (
		scope.status !== "ready" ||
		(kind === "model" && cache.isMutating({ mutationKey: key }))
	)
		return false;
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: key,
		scope: { id: JSON.stringify(key) },
		mutationFn: async () => {
			if (scope !== getResourceScope())
				throw new Error("The active resource changed.");
			const result = await perform();
			if (scope !== getResourceScope())
				throw new Error("The active resource changed.");
			return result;
		},
		onError: (error) => {
			if (scope === getResourceScope())
				notifyError(
					kind === "presets" ? "amount-presets" : "workspace",
					error instanceof Error ? error.message : "The server write failed.",
					{
						label: "Retry server request",
						onAction: () => void reloadWorkspace(),
					},
				);
		},
	});
	try {
		return await mutation.execute(undefined);
	} catch {
		return false;
	}
}

export function useWorkspaceSaving() {
	useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return (
		useIsMutating(
			{ mutationKey: workspaceWriteKey("model") },
			serverQueryClient(),
		) > 0
	);
}

export function useWorkspaceWriteError(kind: "model" | "presets" = "model") {
	useSyncExternalStore(subscribeResourceScope, getResourceScope);
	const errors = useMutationState(
		{
			filters: { mutationKey: workspaceWriteKey(kind) },
			select: (mutation) =>
				mutation.state.status === "error" ? mutation.state.error : null,
		},
		serverQueryClient(),
	);
	return errors.at(-1) ?? null;
}

export async function saveWorkspace(): Promise<boolean> {
	const scope = getResourceScope();
	if (
		serverQueryClient().isFetching({ queryKey: workspaceResourceKey("model") })
	) {
		notifyError(
			"workspace",
			"Wait for the current server load to finish before saving.",
		);
		return false;
	}
	return (
		(await write("model", async () => {
			const document = draftDocumentForSave();
			const draft = useWorkspaceStore.getState().draft!;
			const response = await applyRowOperations(
				diffFinancialModelDocuments(
					getServerModel()?.document ?? null,
					document,
				),
			);
			if (scope !== getResourceScope()) return false;
			if (response instanceof Error) throw response;
			if (!response.ok)
				throw new Error(
					response.issues.map((issue) => issue.message).join(" ") ||
						"The server rejected the save. Your temporary plan remains unsaved.",
				);
			const errors = response.issues.filter(
				(issue) => issue.severity === "error",
			);
			if (errors.length)
				throw new Error(errors.map((issue) => issue.message).join(" "));
			const cache = serverQueryClient();
			await cache.invalidateQueries({
				queryKey: workspaceResourceKey("model", scope),
				refetchType: "none",
			});
			const authoritative = await cache.fetchQuery(modelOptions(scope));
			if (scope !== getResourceScope()) return false;
			if (!authoritative.document)
				throw new Error(
					"The save completed, but the server returned no authoritative model. Your temporary plan remains available locally.",
				);
			const saved = useWorkspaceStore.getState().acknowledgeSave(draft);
			if (saved) {
				dismissKey("workspace");
				notifySuccess("workspace-notice", "Plan saved on the server.");
			}
			return saved;
		})) === true
	);
}

export async function importServerDocument(
	document: FinancialModelDocument,
): Promise<boolean> {
	const scope = getResourceScope();
	if (
		serverQueryClient().isFetching({ queryKey: workspaceResourceKey("model") })
	) {
		notifyError(
			"workspace",
			"Wait for the current server load to finish before importing.",
		);
		return false;
	}
	return (
		(await write("model", async () => {
			if (getServerModel()?.document)
				throw new Error(
					"A server model is already loaded. Use the reviewed import action in Configs.",
				);
			if (getServerStatus()?.readOnly)
				throw new ApiHttpError({
					status: 403,
					message: READ_ONLY_IMPORT_MESSAGE,
				});
			const result = await applyRowOperations(
				diffFinancialModelDocuments(null, document),
			);
			if (scope !== getResourceScope()) return false;
			if (result instanceof Error) throw result;
			if (!result.ok)
				throw new Error(result.issues.map((issue) => issue.message).join(" "));
			const cache = serverQueryClient();
			await cache.invalidateQueries({
				queryKey: workspaceResourceKey("model", scope),
				refetchType: "none",
			});
			const model = await cache.fetchQuery(modelOptions(scope));
			return scope === getResourceScope() && Boolean(model.document);
		})) === true
	);
}

export async function reloadDraft() {
	if (!useWorkspaceStore.getState().discard(true)) return false;
	await reloadWorkspace();
	return Boolean(getServerModel()?.document);
}

async function changePreset(action: () => Promise<{ persisted: boolean }>) {
	const scope = getResourceScope();
	return (
		(await write("presets", async () => {
			await serverQueryClient().cancelQueries({
				queryKey: workspaceResourceKey("presets", scope),
			});
			const response = await action();
			if (!response.persisted)
				throw new Error("The recipe was rejected by the server.");
			if (scope !== getResourceScope()) return false;
			await serverQueryClient().invalidateQueries({
				queryKey: workspaceResourceKey("presets", scope),
				refetchType: "none",
			});
			await serverQueryClient().fetchQuery(presetsOptions(scope));
			dismissKey("amount-presets");
			return true;
		})) === true
	);
}
export const createPreset = (preset: AmountPreset) =>
	changePreset(async () => (await createAmountPreset(preset as never)).data);
export const updatePreset = (preset: AmountPreset) =>
	changePreset(
		async () => (await updateAmountPreset(preset.id, preset as never)).data,
	);
export const deletePreset = (id: string) =>
	changePreset(async () => {
		await deleteAmountPreset(id);
		return { persisted: true };
	});
export const movePreset = (id: string, beforeId: string | null) =>
	changePreset(async () => {
		await moveAmountPreset({ id, beforeId: beforeId ?? undefined });
		return { persisted: true };
	});
