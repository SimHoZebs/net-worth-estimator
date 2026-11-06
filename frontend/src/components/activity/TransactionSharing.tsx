import { useMemo, useState } from "react";
import { Button } from "../Button.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { transactionControlStyles } from "./transactionDetailStyles.ts";
import { notifyError, notifySuccess } from "../../state/notifications.ts";
import { mintShareRequestId } from "../../pages/sharingApi.ts";
import {
	useExcludeSharedTransaction,
	useGrantSharedTransaction,
	useRemoveSharedExclusion,
	useRevokeSharedTransaction,
	useSharingGrants,
} from "../../state/sharing.ts";
import { useGroups } from "../../state/groups.ts";

/**
 * One transaction's explicit sharing intents (GRP-04). Each audience is in
 * exactly one state: default (absent), shared, or excluded. Sharing or
 * hiding here works with or without automatic group sharing, and the
 * server rejects a share that collides with an exclusion (and vice versa)
 * with a message safe to show.
 */
export function TransactionSharing({
	transactionId,
	readOnly,
}: {
	transactionId: string;
	readOnly: boolean;
}) {
	const grantsQuery = useSharingGrants();
	const groupsQuery = useGroups();
	const grantMutation = useGrantSharedTransaction();
	const revokeMutation = useRevokeSharedTransaction();
	const excludeMutation = useExcludeSharedTransaction();
	const removeExclusionMutation = useRemoveSharedExclusion();

	const [shareTarget, setShareTarget] = useState("");
	const [hideTarget, setHideTarget] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const intents = useMemo(
		() =>
			(grantsQuery.data ?? []).filter(
				(grant) => grant.transactionId === transactionId,
			),
		[grantsQuery.data, transactionId],
	);
	const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
	const groupName = useMemo(() => {
		const names = new Map(groups.map((group) => [group.id, group.name]));
		return (id: string) => names.get(id) ?? "A group";
	}, [groups]);

	const usedAudience = useMemo(() => {
		const used = new Set<string>();
		for (const intent of intents) {
			used.add(`${intent.audienceType}:${intent.audienceId}`);
		}
		return used;
	}, [intents]);

	const shareOptions = groups.filter(
		(group) => !usedAudience.has(`group:${group.id}`),
	);
	const hideOptions = groups.filter(
		(group) =>
			!usedAudience.has(`group:${group.id}`) && !usedAudience.has("all:"),
	);
	const wildcardHidden = usedAudience.has("all:");
	// A wildcard exclusion denies before any grant is considered, so
	// shares listed beside it are suppressed, never effective. Sharing
	// stays unavailable until the wildcard exclusion is removed.

	function failureMessage(cause: unknown, fallback: string): string {
		const message =
			cause instanceof Error && cause.message ? cause.message : fallback;
		setError(message);
		notifyError("sharing", message);
		return message;
	}

	async function run(action: () => Promise<unknown>, notice: string) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await action();
			setShareTarget("");
			setHideTarget("");
			notifySuccess("sharing-notice", notice);
		} catch (cause) {
			failureMessage(cause, notice.replace(/.$/, " failed."));
		} finally {
			setBusy(false);
		}
	}

	function onShare() {
		if (!shareTarget) return;
		const requestId = mintShareRequestId();
		void run(
			() =>
				grantMutation.mutateAsync({
					transactionId,
					audienceId: shareTarget,
					requestId,
				}),
			"Transaction shared with the group.",
		);
	}

	function onHide() {
		if (!hideTarget) return;
		const wildcard = hideTarget === "all";
		const requestId = mintShareRequestId();
		void run(
			() =>
				excludeMutation.mutateAsync({
					transactionId,
					audienceType: wildcard ? "all" : "group",
					audienceId: wildcard ? "" : hideTarget,
					requestId,
				}),
			wildcard
				? "Transaction hidden from everyone, including future groups."
				: "Transaction hidden from the group.",
		);
	}

	function onRevoke(audienceType: string, audienceId: string) {
		const requestId = mintShareRequestId();
		void run(
			() =>
				revokeMutation.mutateAsync({
					transactionId,
					audienceType,
					audienceId,
					requestId,
				}),
			"Share removed.",
		);
	}

	function onRemoveExclusion(audienceType: string, audienceId: string) {
		const requestId = mintShareRequestId();
		void run(
			() =>
				removeExclusionMutation.mutateAsync({
					transactionId,
					audienceType,
					audienceId,
					requestId,
				}),
			"Hidden audience removed.",
		);
	}

	if (grantsQuery.isPending || groupsQuery.isPending) {
		return (
			<p className="m-0 text-sm text-muted" role="status">
				Loading sharing…
			</p>
		);
	}

	if (grantsQuery.isError || groupsQuery.isError) {
		return (
			<ErrorNotice
				message="Sharing could not be loaded."
				action="Retry"
				onAction={() => {
					void grantsQuery.refetch();
					void groupsQuery.refetch();
				}}
			/>
		);
	}

	return (
		<section aria-label="Sharing" className="grid gap-3">
			<div>
				<h3 className="m-0 text-sm font-medium">Sharing</h3>
			</div>

			{error && <ErrorNotice message={error} />}

			{intents.length > 0 && (
				<ul className="grid list-none gap-2 p-0">
					{intents.map((intent) => (
						<li
							key={`${intent.audienceType}:${intent.audienceId}`}
							className="flex items-center justify-between gap-3 rounded-control border border-solid border-line px-3 py-2 text-sm"
						>
							<span>
								{intent.intent === "shared" ? (
									<>
										Shared with <strong>{groupName(intent.audienceId)}</strong>
										{wildcardHidden && (
											<span className="text-muted">
												{" "}
												— hidden while the everyone exclusion lasts
											</span>
										)}
									</>
								) : intent.audienceType === "all" ? (
									<>
										Hidden from{" "}
										<strong>everyone, including future groups</strong>
									</>
								) : (
									<>
										Hidden from <strong>{groupName(intent.audienceId)}</strong>
									</>
								)}
							</span>
							{!readOnly && (
								<Button
									variant="ghost"
									size="sm"
									disabled={busy}
									onClick={() =>
										intent.intent === "shared"
											? onRevoke(intent.audienceType, intent.audienceId)
											: onRemoveExclusion(
													intent.audienceType,
													intent.audienceId,
												)
									}
								>
									{intent.intent === "shared" ? "Stop sharing" : "Remove"}
								</Button>
							)}
						</li>
					))}
				</ul>
			)}

			{!readOnly && (
				<div className="grid gap-3">
					<div className="grid gap-2">
						<label
							className="grid gap-1 text-sm"
							htmlFor={`share-group-${transactionId}`}
						>
							<span className="font-medium">Share with a group</span>
							<span className="text-muted">
								The group sees this transaction in its usual shape. Works with
								or without automatic sharing.
							</span>
						</label>
						<div className="flex flex-wrap gap-2">
							<select
								id={`share-group-${transactionId}`}
								value={shareTarget}
								disabled={busy || wildcardHidden || shareOptions.length === 0}
								onChange={(event) => {
									setError(null);
									setShareTarget(event.target.value);
								}}
								className={transactionControlStyles({
									element: "select",
									shape: "account",
								})}
							>
								<option value="">Choose a group…</option>
								{shareOptions.map((group) => (
									<option key={group.id} value={group.id}>
										{group.name}
									</option>
								))}
							</select>
							<Button
								size="sm"
								disabled={busy || wildcardHidden || !shareTarget}
								onClick={onShare}
							>
								{busy ? "Sharing…" : "Share"}
							</Button>
						</div>
						{wildcardHidden && (
							<p className="m-0 text-sm text-muted">
								Sharing is paused while this transaction is hidden from
								everyone. Remove that exclusion to share again.
							</p>
						)}
					</div>

					<div className="grid gap-2">
						<label
							className="grid gap-1 text-sm"
							htmlFor={`hide-group-${transactionId}`}
						>
							<span className="font-medium">Hide from a group or everyone</span>
							<span className="text-muted">
								Hiding wins over sharing. Hiding from everyone also covers
								groups you join later and stays until removed.
							</span>
						</label>
						<div className="flex flex-wrap gap-2">
							<select
								id={`hide-group-${transactionId}`}
								value={hideTarget}
								disabled={busy || (wildcardHidden && hideOptions.length === 0)}
								onChange={(event) => {
									setError(null);
									setHideTarget(event.target.value);
								}}
								className={transactionControlStyles({
									element: "select",
									shape: "account",
								})}
							>
								<option value="">Choose who…</option>
								{hideOptions.map((group) => (
									<option key={group.id} value={group.id}>
										{group.name}
									</option>
								))}
								{!wildcardHidden && (
									<option value="all">Everyone, including future groups</option>
								)}
							</select>
							<Button
								size="sm"
								variant="secondary"
								disabled={busy || !hideTarget}
								onClick={onHide}
							>
								{busy ? "Hiding…" : "Hide"}
							</Button>
						</div>
					</div>
				</div>
			)}
		</section>
	);
}
