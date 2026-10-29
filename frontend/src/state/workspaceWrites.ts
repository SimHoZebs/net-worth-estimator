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
import type { Plan } from "@/domain/model.ts";
import { getUserScope, subscribeUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import {
	getServerModel,
	getServerStatus,
	modelOptions,
	presetsOptions,
	reloadWorkspace,
	workspaceIsBusy,
	userResourceKey,
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
	return ["workspace-write", getUserScope().key, kind] as const;
}

/** Backend save envelope: persisted with issues, or rejected with reasons. */
export interface SaveResult {
	issues?: { severity: string; message?: string | null }[] | null;
	persisted?: boolean;
}

function saveRejection(envelope: SaveResult): string | null {
	if (envelope.persisted === false) {
		const messages = (envelope.issues ?? [])
			.map((issue) => issue.message)
			.filter(Boolean);
		return messages.length
			? messages.join(" ")
			: "The server rejected the change.";
	}
	const errors = (envelope.issues ?? []).filter(
		(issue) => issue.severity === "error",
	);
	if (errors.length) return errors.map((issue) => issue.message).join(" ");
	return null;
}

/**
 * One immediate save behind a form action: guard the workspace, run the
 * call, surface a rejection notice, then refresh the given queries.
 * Returns true only when the server persisted the change.
 */
export async function performSave(options: {
	call: () => Promise<{ data: unknown }>;
	refresh: () => Promise<void>;
	failureMessage: string;
}): Promise<boolean> {
	if (workspaceIsBusy()) {
		notifyError(
			"workspace",
			"Wait for the current server operation to finish before editing.",
		);
		return false;
	}
	if (getUserScope().status !== "ready") {
		notifyError("workspace", "Load the server workspace before editing it.");
		return false;
	}
	try {
		const envelope = (await options.call()).data as unknown as SaveResult;
		const rejection = saveRejection(envelope);
		if (rejection) {
			notifyError("workspace", rejection);
			return false;
		}
		await options.refresh();
		return true;
	} catch (cause) {
		notifyError(
			"workspace",
			cause instanceof Error ? cause.message : options.failureMessage,
		);
		return false;
	}
}

async function write<T>(
	kind: "model" | "presets",
	perform: () => Promise<T>,
): Promise<T | false> {
	const scope = getUserScope();
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
			if (scope !== getUserScope())
				throw new Error("The active resource changed.");
			const result = await perform();
			if (scope !== getUserScope())
				throw new Error("The active resource changed.");
			return result;
		},
		onError: (error) => {
			if (scope === getUserScope())
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
	useSyncExternalStore(subscribeUserScope, getUserScope);
	return (
		useIsMutating(
			{ mutationKey: workspaceWriteKey("model") },
			serverQueryClient(),
		) > 0
	);
}

export function useWorkspaceWriteError(kind: "model" | "presets" = "model") {
	useSyncExternalStore(subscribeUserScope, getUserScope);
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
	const scope = getUserScope();
	if (serverQueryClient().isFetching({ queryKey: userResourceKey("model") })) {
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
			if (scope !== getUserScope()) return false;
			if (response instanceof Error) throw response;
			if (!response.ok)
				throw new Error(
					response.issues.map((issue) => issue.message).join(" ") ||
						"The server rejected the save. Your changes remain unsaved.",
				);
			const errors = response.issues.filter(
				(issue) => issue.severity === "error",
			);
			if (errors.length)
				throw new Error(errors.map((issue) => issue.message).join(" "));
			const cache = serverQueryClient();
			await cache.invalidateQueries({
				queryKey: userResourceKey("model", scope),
				refetchType: "none",
			});
			const authoritative = await cache.fetchQuery(modelOptions(scope));
			if (scope !== getUserScope()) return false;
			if (!authoritative.document)
				throw new Error(
					"The save completed, but the server returned no saved data. Your unsaved changes remain available locally.",
				);
			const saved = useWorkspaceStore.getState().acknowledgeSave(draft);
			if (saved) {
				dismissKey("workspace");
				notifySuccess("workspace-notice", "Changes saved.");
			}
			return saved;
		})) === true
	);
}

/**
 * Stage an edit and persist it immediately, so one Save press means saved.
 * Returns false (and saves nothing) when the edit is rejected or changes
 * nothing. A failed save keeps the staged draft; retry it from the banner.
 */
export function stageAndSave(next: Plan): boolean {
	const staged = useWorkspaceStore.getState().updatePlan(next);
	if (!staged || !useWorkspaceStore.getState().draft) return staged;
	void saveWorkspace();
	return true;
}

export async function importServerDocument(
	document: FinancialModelDocument,
): Promise<boolean> {
	const scope = getUserScope();
	if (serverQueryClient().isFetching({ queryKey: userResourceKey("model") })) {
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
			if (scope !== getUserScope()) return false;
			if (result instanceof Error) throw result;
			if (!result.ok)
				throw new Error(result.issues.map((issue) => issue.message).join(" "));
			const cache = serverQueryClient();
			await cache.invalidateQueries({
				queryKey: userResourceKey("model", scope),
				refetchType: "none",
			});
			const model = await cache.fetchQuery(modelOptions(scope));
			return scope === getUserScope() && Boolean(model.document);
		})) === true
	);
}

export async function reloadDraft() {
	if (!useWorkspaceStore.getState().discard(true)) return false;
	await reloadWorkspace();
	return Boolean(getServerModel()?.document);
}

async function changePreset(action: () => Promise<{ persisted: boolean }>) {
	const scope = getUserScope();
	return (
		(await write("presets", async () => {
			await serverQueryClient().cancelQueries({
				queryKey: userResourceKey("presets", scope),
			});
			const response = await action();
			if (!response.persisted)
				throw new Error("The recipe was rejected by the server.");
			if (scope !== getUserScope()) return false;
			await serverQueryClient().invalidateQueries({
				queryKey: userResourceKey("presets", scope),
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
