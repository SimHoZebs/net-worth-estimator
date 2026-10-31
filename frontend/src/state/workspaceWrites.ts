import { useIsMutating, useMutationState } from "@tanstack/react-query";
import {
	createAmountPreset,
	deleteAmountPreset,
	moveAmountPreset,
	updateAmountPreset,
} from "@/api/generated/endpoints.ts";
import { applyRowOperations, diffFinancialModels } from "@/api/rowSync.ts";
import {
	ApiHttpError,
	type AmountPreset,
	type FinancialModel,
	READ_ONLY_IMPORT_MESSAGE,
} from "@/api/index.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { useUserScope } from "@/state/useUserScope.ts";
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
 * Returns true only when the server persisted the change and the
 * authoritative refresh completed for the same resource.
 *
 * The save runs inside the single `write("model", …)` Query mutation, so
 * `workspaceIsBusy`/`useWorkspaceSaving` observe it, overlapping saves
 * collapse to one `call`, and transport failures (including 403s) land in
 * the mutation error state that `useWorkspaceWriteError`/`useUserReadOnly`
 * read. The mutation stays silent; this function owns the one notice.
 *
 * Multi-row writes can persist partially before failing, so a rejection or
 * a transport error still reloads authoritative state first — but only
 * while the original resource stays current. A resource switch at any
 * awaited boundary reports failure silently: no refresh, no stale notice,
 * no success. Returning false always keeps the caller's edited form
 * intact for retry. When the write persisted but the reload failed, the
 * notice says exactly that instead of claiming nothing was saved.
 * Success owns the shared "Changes saved." confirmation.
 */
export async function performSave(options: {
	call: () => Promise<{ data: unknown }>;
	refresh: () => Promise<void>;
	failureMessage: string;
}): Promise<boolean> {
	const scope = getUserScope();
	if (workspaceIsBusy()) {
		notifyError(
			"workspace",
			"Wait for the current server operation to finish before editing.",
		);
		return false;
	}
	if (scope.status !== "ready") {
		notifyError("workspace", "Load the server workspace before editing it.");
		return false;
	}
	const saved = await write(
		"model",
		async () => {
			let envelope: unknown;
			try {
				envelope = (await options.call()).data;
			} catch (cause) {
				if (scope === getUserScope()) {
					await options.refresh().catch(() => {});
					if (scope === getUserScope())
						notifyError(
							"workspace",
							cause instanceof Error ? cause.message : options.failureMessage,
						);
				}
				throw cause instanceof Error
					? cause
					: new Error(options.failureMessage);
			}
			if (scope !== getUserScope()) return false;
			const rejection = saveRejection(envelope as SaveResult);
			if (rejection) {
				await options.refresh().catch(() => {});
				if (scope === getUserScope()) notifyError("workspace", rejection);
				throw new Error(rejection);
			}
			try {
				await options.refresh();
			} catch {
				if (scope !== getUserScope()) return false;
				const message =
					"The change was saved, but the latest server data could not be reloaded. Retry the server request.";
				notifyError("workspace", message);
				throw new Error(message);
			}
			if (scope !== getUserScope()) return false;
			return true;
		},
		{ silent: true },
	);
	if (saved !== true) return false;
	if (scope !== getUserScope()) return false;
	notifySuccess("workspace-notice", "Changes saved.");
	return true;
}

async function write<T>(
	kind: "model" | "presets",
	perform: () => Promise<T>,
	opts?: { silent?: boolean },
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
			if (opts?.silent) return;
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
	useUserScope();
	return (
		useIsMutating(
			{ mutationKey: workspaceWriteKey("model") },
			serverQueryClient(),
		) > 0
	);
}

export function useWorkspaceWriteError(kind: "model" | "presets" = "model") {
	useUserScope();
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

export async function importServerModel(
	model: FinancialModel,
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
			if (getServerModel()?.model)
				throw new Error(
					"A server model is already loaded. Use the reviewed import action in Configs.",
				);
			if (getServerStatus()?.readOnly)
				throw new ApiHttpError({
					status: 403,
					message: READ_ONLY_IMPORT_MESSAGE,
				});
			const result = await applyRowOperations(diffFinancialModels(null, model));
			if (scope !== getUserScope()) return false;
			if (result instanceof Error) throw result;
			if (!result.ok)
				throw new Error(result.issues.map((issue) => issue.message).join(" "));
			const cache = serverQueryClient();
			await cache.invalidateQueries({
				queryKey: userResourceKey("model", scope),
				refetchType: "none",
			});
			const response = await cache.fetchQuery(modelOptions(scope));
			return scope === getUserScope() && Boolean(response.model);
		})) === true
	);
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
