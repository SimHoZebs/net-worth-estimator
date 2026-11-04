import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/http.ts";
import { AccountToggle } from "../components/AccountToggle.tsx";
import { Button } from "../components/Button.tsx";
import { ErrorNotice } from "../components/ErrorNotice.tsx";
import { InputField } from "../components/Field.tsx";
import { notifyError, notifySuccess } from "../state/notifications.ts";
import { useSavedAccounts } from "../state/savedState.ts";
import {
	refreshSharingViewsFor,
	useSetSharingPolicy,
	useSharingGrants,
	useSharingPolicy,
	useSharingPreview,
} from "../state/sharing.ts";
import { mintShareRequestId, revokeSharedPosting } from "../pages/sharingApi.ts";
import type { SharingPolicyInput } from "../pages/sharingApi.ts";

function todayDay(): string {
	return new Date().toISOString().slice(0, 10);
}

function serverMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message
		? cause.message
		: fallback;
}

/**
 * One member's own automatic-sharing consent for one group (GRP-04).
 * Sharing stays off until this member opts in; nobody else can change it.
 * The server counts the current exposure for the draft accounts and dates
 * (counts only, never amounts or payees) and the member enables only after
 * seeing that preview plus the historical-disclosure warning.
 */
export function GroupSharingSection({ groupId }: { groupId: string }) {
	const policyQuery = useSharingPolicy(groupId);
	const policy = policyQuery.data ?? null;
	const accounts = useSavedAccounts();
	const grantsQuery = useSharingGrants();
	const setPolicy = useSetSharingPolicy();

	const [accountIds, setAccountIds] = useState<string[] | null>(null);
	const [startDate, setStartDate] = useState<string | null>(null);
	const [endDate, setEndDate] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [confirmStop, setConfirmStop] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	// Editing starts from the stored preference when one exists, otherwise
	// from the setup-day default: today, open-ended, nothing selected.
	// Selected accounts that no longer exist match nothing and the server
	// rejects them on save, so they drop out of the draft once the owned
	// list has loaded. The drift stays visible in the note below.
	const ownedIds = useMemo(
		() => new Set((accounts ?? []).map((account) => account.id)),
		[accounts],
	);
	const draftAccounts = useMemo(() => {
		const base = accountIds ?? policy?.accountIds ?? [];
		if (accounts === null) return base;
		return base.filter((id) => ownedIds.has(id));
	}, [accountIds, policy, accounts, ownedIds]);
	const draftStart = startDate ?? policy?.startDate ?? todayDay();
	const draftEnd = endDate ?? policy?.endDate ?? "";

	// The live preview follows the draft after a short pause so every
	// keystroke does not start a server count.
	const [debounced, setDebounced] = useState({
		accounts: draftAccounts,
		start: draftStart,
		end: draftEnd,
	});
	useEffect(() => {
		const timer = setTimeout(
			() =>
				setDebounced({
					accounts: draftAccounts,
					start: draftStart,
					end: draftEnd,
				}),
			350,
		);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftAccounts.join(","), draftStart, draftEnd]);

	const previewInput = useMemo<Omit<SharingPolicyInput, "enabled"> | null>(
		() =>
			debounced.accounts.length > 0
				? {
						accountIds: debounced.accounts,
						startDate: debounced.start,
						endDate: debounced.end || undefined,
					}
				: null,
		[debounced],
	);
	const previewQuery = useSharingPreview(groupId, previewInput);
	const preview = previewQuery.data ?? null;

	// Selected accounts that no longer exist match nothing on the server
	// (account deletion strips them); surface the drift instead of hiding it.
	const staleSelections = useMemo(
		() =>
			(policy?.accountIds ?? []).filter(
				(id) => accounts !== null && !ownedIds.has(id),
			),
		[policy, accounts, ownedIds],
	);

	const sharedGrants = useMemo(
		() =>
			(grantsQuery.data ?? []).filter(
				(grant) => grant.intent === "shared",
			),
		[grantsQuery.data],
	);

	// Dirty compares against the persisted selection minus deleted ids, so
	// the drift note alone never reads as an unsaved edit.
	const persistedAccounts = useMemo(() => {
		const base = policy?.accountIds ?? [];
		if (accounts === null) return base;
		return base.filter((id) => ownedIds.has(id));
	}, [policy, accounts, ownedIds]);

	function toggleAccount(id: string) {
		setFormError(null);
		setAccountIds((current) => {
			const base = current ?? draftAccounts;
			return base.includes(id)
				? base.filter((entry) => entry !== id)
				: [...base, id];
		});
	}

	async function save(input: SharingPolicyInput, notice: string) {
		setSaving(true);
		setFormError(null);
		try {
			await setPolicy.mutateAsync({ groupId, input });
			setAccountIds(null);
			setStartDate(null);
			setEndDate(null);
			notifySuccess("groups-notice", notice);
		} catch (cause) {
			const message = serverMessage(cause, "Sharing could not be saved.");
			setFormError(message);
			notifyError("groups", message);
		} finally {
			setSaving(false);
		}
	}

	function onEnable() {
		void save(
			{
				enabled: true,
				accountIds: draftAccounts,
				startDate: draftStart,
				endDate: draftEnd || undefined,
			},
			"Sharing turned on.",
		);
	}

	function onSave() {
		void save(
			{
				enabled: policy?.enabled ?? false,
				accountIds: draftAccounts,
				startDate: draftStart,
				endDate: draftEnd || undefined,
			},
			"Sharing preferences saved.",
		);
	}

	function onDisable() {
		setConfirmStop(false);
		void save(
			{
				enabled: false,
				accountIds: draftAccounts,
				startDate: draftStart,
				endDate: draftEnd || undefined,
			},
			"Automatic sharing turned off.",
		);
	}

	// Stop-sharing-with-everyone composes the normal revocations: the
	// preference is disabled and every one-off share is revoked. Copies a
	// recipient already accepted stay with them and cannot be removed here.
	async function onStopSharing() {
		if (!confirmStop) {
			setConfirmStop(true);
			return;
		}
		setStopping(true);
		setFormError(null);
		try {
			await setPolicy.mutateAsync({
				groupId,
				input: {
					enabled: false,
					accountIds: draftAccounts,
					startDate: draftStart,
					endDate: draftEnd || undefined,
				},
			});
			for (const grant of sharedGrants) {
				try {
					await revokeSharedPosting(
						grant.postingId,
						grant.audienceType,
						grant.audienceId,
						mintShareRequestId(),
					);
				} catch (cause) {
					// A grant revoked elsewhere reports 404: it is already
					// removed, so continue with the remainder instead of
					// aborting the stop.
					if (cause instanceof ApiError && cause.status === 404)
						continue;
					throw cause;
				}
			}
			void refreshSharingViewsFor(groupId);
			setAccountIds(null);
			setStartDate(null);
			setEndDate(null);
			setConfirmStop(false);
			notifySuccess("groups-notice", "Stopped sharing with everyone.");
		} catch (cause) {
			// Refresh every sharing view so the visible state matches the
			// server and a retry replays from live rows, never a stale list.
			void refreshSharingViewsFor(groupId);
			const message = serverMessage(
				cause,
				"Sharing could not be stopped.",
			);
			setFormError(message);
			notifyError("groups", message);
		} finally {
			setStopping(false);
		}
	}

	if (policyQuery.isPending) {
		return (
			<p className="m-0 text-sm text-muted" role="status">
				Loading sharing…
			</p>
		);
	}

	if (policyQuery.isError) {
		return (
			<ErrorNotice
				message="Sharing could not be loaded."
				action="Retry"
				onAction={() => void policyQuery.refetch()}
			/>
		);
	}

	const dirty =
		accountIds !== null ||
		startDate !== null ||
		endDate !== null ||
		(policy !== null &&
			(policy.enabled ||
				persistedAccounts.join(",") !== draftAccounts.join(",") ||
				policy.startDate !== draftStart ||
				(policy.endDate ?? "") !== draftEnd));

	return (
		<section aria-label="My sharing" className="grid gap-4">
			<div>
				<h2 className="m-0 text-base">My sharing</h2>
				<p className="mb-0 text-sm text-muted">
					{policy?.enabled
						? "Automatic sharing is on for this group."
						: "Automatic sharing is off. Only you can turn it on."}
				</p>
			</div>

			{formError && <ErrorNotice message={formError} />}

			<fieldset className="grid gap-2 border-0 p-0">
				<legend className="px-0 text-sm font-medium">
					Accounts to share
				</legend>
				{accounts === null ? (
					<p className="m-0 text-sm text-muted" role="status">
						Loading accounts…
					</p>
				) : accounts.length === 0 ? (
					<p className="m-0 text-sm text-muted">
						No accounts yet. Add an account before sharing.
					</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{accounts.map((account) => (
							<AccountToggle
								key={account.id}
								account={account}
								checked={draftAccounts.includes(account.id)}
								disabled={saving || stopping}
								onToggle={() => toggleAccount(account.id)}
							/>
						))}
					</div>
				)}
			</fieldset>

			{staleSelections.length > 0 && (
				<p className="m-0 text-sm text-muted" role="note">
					{staleSelections.length} previously selected{" "}
					{staleSelections.length === 1 ? "account no longer" : "accounts no longer"}{" "}
					exist, so {staleSelections.length === 1 ? "it was" : "they were"} removed
					from the selection. Saving keeps it that way.
				</p>
			)}

			<div className="grid max-w-md gap-2">
				<InputField
					label="Share from"
					type="date"
					value={draftStart}
					maxLength={10}
					onChange={(event) => {
						setFormError(null);
						setStartDate(event.target.value);
					}}
				/>
				<InputField
					label="Share until (leave empty for no end)"
					type="date"
					value={draftEnd}
					maxLength={10}
					onChange={(event) => {
						setFormError(null);
						setEndDate(event.target.value);
					}}
				/>
			</div>

			{draftAccounts.length > 0 && (
				<div className="grid gap-2 rounded-control border border-solid border-line px-3 py-2 text-sm">
					<p className="m-0">
						<strong>Before you turn this on.</strong> Sharing
						covers matching transactions already inside these
						dates, and later bank imports can add older matching
						transactions on their own. There is no second review
						step for those.
					</p>
					{previewQuery.isPending ? (
						<p className="m-0 text-muted" role="status">
							Counting matching transactions…
						</p>
					) : previewQuery.isError ? (
						<p className="m-0" role="alert">
							Preview unavailable:{" "}
							{serverMessage(
								previewQuery.error,
								"the selection could not be counted.",
							)}
						</p>
					) : (
						preview && (
							<p className="m-0 text-muted">
								{preview.eligiblePostings}{" "}
								{preview.eligiblePostings === 1
									? "transaction"
									: "transactions"}{" "}
								across {preview.accountIds.length}{" "}
								{preview.accountIds.length === 1
									? "account"
									: "accounts"}{" "}
								from {preview.startDate}
								{preview.endDate
									? ` to ${preview.endDate}`
									: " with no end"}{" "}
								match this selection for{" "}
								{preview.memberCount}{" "}
								{preview.memberCount === 1
									? "member"
									: "members"}
								. Transactions hidden individually still
								count here but stay hidden. Only counts are
								shown here, never amounts or payees.
							</p>
						)
					)}
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				{policy?.enabled ? (
					<Button
						size="sm"
						disabled={saving || stopping}
						onClick={onDisable}
					>
						{saving ? "Turning off…" : "Turn off automatic sharing"}
					</Button>
				) : (
					<Button
						variant="primary"
						size="sm"
						disabled={
							saving ||
							stopping ||
							draftAccounts.length === 0 ||
							!draftStart
						}
						onClick={onEnable}
					>
						{saving ? "Turning on…" : "Turn on sharing"}
					</Button>
				)}
				{(policy?.enabled || sharedGrants.length > 0) && (
					<Button
						variant="ghost"
						size="sm"
						disabled={saving || stopping}
						onClick={() => void onStopSharing()}
					>
						{stopping
							? "Stopping…"
							: confirmStop
								? "Confirm: stop sharing with everyone"
								: "Stop sharing with everyone"}
					</Button>
				)}
			</div>

			{dirty && !policy?.enabled && (
				<p className="m-0 text-sm text-muted">
					Unsaved changes. They take effect when you turn sharing on.
				</p>
			)}
			{policy?.enabled && dirty && (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						disabled={saving || stopping}
						onClick={onSave}
					>
						{saving ? "Saving…" : "Save changes"}
					</Button>
					<span className="text-sm text-muted">
						Narrowing dates or accounts revokes access that no
						longer matches.
					</span>
				</div>
			)}

			<p className="m-0 text-sm text-muted">
				Single transactions can be shared with, or hidden from, a
				group from their detail view, with or without automatic
				sharing. Copies a member already accepted stay with them.
			</p>
		</section>
	);
}
