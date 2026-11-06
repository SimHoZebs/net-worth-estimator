import { useQuery } from "@tanstack/react-query";
import {
	disconnectGmailCredential,
	getGmailAuthUrl,
	getGmailCredential,
	listGmailReceipts,
	reviewGmailReceipt,
	scanGmailReceipts,
	setGmailLookback,
} from "@/api/generated/endpoints.ts";
import type {
	EmailReceipt,
	EmailReceiptCorrection,
	GmailCredentialBody,
	ScanSummary,
} from "@/api/generated/model/index.ts";
import {
	getUserScope,
	subscribeUserScope,
	type UserScope,
} from "@/auth/resourceScope.ts";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { refreshIntegrations } from "@/state/integrations.ts";
import { useUserScope } from "@/state/useUserScope.ts";

export function gmailCredentialKey(scope = getUserScope()) {
	return ["gmail-credential", scope.key] as const;
}

function current(scope: UserScope, signal?: AbortSignal) {
	if (scope !== getUserScope() || scope.status !== "ready" || signal?.aborted)
		throw new Error("The active resource changed or the request was canceled.");
}

function credentialOptions(scope = getUserScope()) {
	return {
		queryKey: gmailCredentialKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data: GmailCredentialBody = (await getGmailCredential({ signal }))
					.data;
				current(scope, signal);
				dismissKey("gmail-credential");
				return data;
			} catch (error) {
				if (scope === getUserScope() && !signal.aborted)
					notifyError(
						"gmail-credential",
						error instanceof Error
							? error.message
							: "The Gmail connection could not be loaded.",
						{
							label: "Reload Gmail",
							onAction: () => void refreshGmailSettings(true),
						},
					);
				throw error;
			}
		},
	};
}

export async function refreshGmailSettings(force = false): Promise<void> {
	const scope = getUserScope();
	if (scope.status === "pending") return;
	try {
		const options = credentialOptions(scope);
		if (force)
			await serverQueryClient().invalidateQueries({
				queryKey: options.queryKey,
				refetchType: "none",
			});
		await serverQueryClient().fetchQuery(options);
	} catch {
		/* The query reports its current-resource failure. */
	}
	void refreshIntegrations(true);
}

async function runMutation<T>(
	key: readonly unknown[],
	mutationFn: () => Promise<T>,
	notice: string,
): Promise<T | null> {
	const scope = getUserScope();
	if (scope.status === "pending") return null;
	const cache = serverQueryClient();
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: key,
		scope: { id: JSON.stringify(key) },
		mutationFn: async () => {
			if (scope !== getUserScope())
				throw new Error("The active resource changed.");
			return mutationFn();
		},
	});
	try {
		const result = await mutation.execute(undefined);
		if (scope !== getUserScope()) return null;
		return result as T;
	} catch (error) {
		if (scope === getUserScope())
			notifyError(
				notice,
				error instanceof Error ? error.message : "The Gmail request failed.",
			);
		return null;
	}
}

// startGmailConsent fetches the server-built consent URL (read-only scope,
// offline access, consent prompt) and navigates the browser to Google. The
// URL is never rendered: it carries single-use CSRF state.
export async function startGmailConsent(): Promise<boolean> {
	const scope = getUserScope();
	if (scope.status === "pending") return false;
	const response = await runMutation<{ url: string }>(
		[...gmailCredentialKey(scope), "auth-url"],
		async () => (await getGmailAuthUrl()).data,
		"gmail-credential",
	);
	if (!response?.url) return false;
	window.location.assign(response.url);
	return true;
}

export async function disconnectGmail(): Promise<boolean> {
	const scope = getUserScope();
	const updated = await runMutation<GmailCredentialBody>(
		gmailCredentialKey(scope),
		async () => (await disconnectGmailCredential()).data,
		"gmail-credential",
	);
	if (!updated) return false;
	serverQueryClient().setQueryData(gmailCredentialKey(scope), updated);
	void refreshIntegrations(true);
	dismissKey("gmail-credential");
	return true;
}

export async function setGmailLookbackDays(
	lookbackDays: number,
): Promise<boolean> {
	const scope = getUserScope();
	const updated = await runMutation<GmailCredentialBody>(
		gmailCredentialKey(scope),
		async () => (await setGmailLookback({ lookbackDays })).data,
		"gmail-credential",
	);
	if (!updated) return false;
	serverQueryClient().setQueryData(gmailCredentialKey(scope), updated);
	void refreshIntegrations(true);
	dismissKey("gmail-credential");
	return true;
}

export function resetGmailClient(): void {
	serverQueryClient().removeQueries({ queryKey: ["gmail-credential"] });
	serverQueryClient().removeQueries({ queryKey: ["gmail-receipts"] });
}

subscribeUserScope(resetGmailClient);

export function useGmailCredential() {
	const scope = useUserScope();
	return useQuery(
		{ ...credentialOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
}

export function gmailReceiptsKey(scope = getUserScope()) {
	return ["gmail-receipts", scope.key] as const;
}

function receiptsOptions(scope = getUserScope()) {
	return {
		queryKey: gmailReceiptsKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data = (
					await listGmailReceipts({ verdict: "receipt,refund" }, { signal })
				).data;
				current(scope, signal);
				dismissKey("gmail-receipts");
				return data.receipts as EmailReceipt[];
			} catch (error) {
				if (scope === getUserScope() && !signal.aborted)
					notifyError(
						"gmail-receipts",
						error instanceof Error
							? error.message
							: "The extracted receipts could not be loaded.",
						{
							label: "Reload receipts",
							onAction: () => void refreshGmailReceipts(true),
						},
					);
				throw error;
			}
		},
	};
}

export async function refreshGmailReceipts(force = false): Promise<void> {
	const scope = getUserScope();
	if (scope.status === "pending") return;
	try {
		const options = receiptsOptions(scope);
		if (force)
			await serverQueryClient().invalidateQueries({
				queryKey: options.queryKey,
				refetchType: "none",
			});
		await serverQueryClient().fetchQuery(options);
	} catch {
		/* The query reports its current-resource failure. */
	}
}

export function useGmailReceipts() {
	const scope = useUserScope();
	return useQuery(
		{ ...receiptsOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
}

// scanGmailReceiptsNow runs one receipt-discovery scan and refreshes the
// extracted list plus the connection's last-scan time. The summary
// returns null when the scan could not start.
export async function scanGmailReceiptsNow(): Promise<ScanSummary | null> {
	const scope = getUserScope();
	const summary = await runMutation<ScanSummary>(
		[...gmailReceiptsKey(scope), "scan"],
		async () => (await scanGmailReceipts()).data,
		"gmail-receipts",
	);
	if (!summary) return null;
	if (scope !== getUserScope()) return null;
	void refreshGmailReceipts(true);
	void refreshGmailSettings(true);
	return summary;
}

// confirmGmailReceipt confirms or corrects one extraction. The
// correction overlays the original values; the server preserves the
// original extraction and provenance.
export async function confirmGmailReceipt(
	id: string,
	correction?: EmailReceiptCorrection,
): Promise<EmailReceipt | null> {
	const scope = getUserScope();
	const updated = await runMutation<EmailReceipt>(
		[...gmailReceiptsKey(scope), id],
		async () =>
			(await reviewGmailReceipt(id, correction ? { correction } : {})).data
				.receipt as EmailReceipt,
		"gmail-receipts",
	);
	if (!updated) return null;
	if (scope !== getUserScope()) return null;
	serverQueryClient().setQueryData<EmailReceipt[]>(
		gmailReceiptsKey(scope),
		(previous) =>
			previous?.map((item) => (item.id === updated.id ? updated : item)) ?? [
				updated,
			],
	);
	return updated;
}
