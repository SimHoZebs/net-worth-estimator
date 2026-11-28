import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { ApiError } from "../api/http.ts";
import { AccountToggle } from "../components/AccountToggle.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Field,
	FieldContent,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { notifyError, notifySuccess } from "../state/notifications.ts";
import { useSavedAccounts } from "../state/savedState.ts";
import {
	refreshSharingViewsFor,
	useSetSharingPolicy,
	useSharingGrants,
	useSharingPolicy,
	useSharingPreview,
} from "../state/sharing.ts";
import {
	mintShareRequestId,
	revokeSharedTransaction,
} from "../pages/sharingApi.ts";
import type { SharingPolicyInput } from "../pages/sharingApi.ts";

function todayDay(): string {
	return new Date().toISOString().slice(0, 10);
}

function serverMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}

function InlineError({
	message,
	action,
	onAction,
}: {
	message: string | null;
	action: string;
	onAction: () => void;
}) {
	if (!message) return null;
	return (
		<Alert variant="destructive">
			<AlertCircle size={16} aria-hidden="true" />
			<AlertDescription>
				{message}{" "}
				<Button variant="link" onClick={onAction}>
					{action}
				</Button>
			</AlertDescription>
		</Alert>
	);
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
	const shareFromId = useId();
	const shareUntilId = useId();
	const noEndDateId = useId();

	const [accountIds, setAccountIds] = useState<string[] | null>(null);
	const [startDate, setStartDate] = useState<string | null>(null);
	const [endDate, setEndDate] = useState<string | null>(null);
	const [noEndDate, setNoEndDate] = useState<boolean | null>(null);
	const [saving, setSaving] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [confirmStop, setConfirmStop] = useState(false);

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
	const draftNoEndDate = noEndDate ?? (policy !== null && !policy.endDate);
	const draftPolicyEnd = draftNoEndDate ? "" : draftEnd;
	const endChoiceValid = draftNoEndDate || draftPolicyEnd.length > 0;

	// The live preview follows the draft after a short pause so every
	// keystroke does not start a server count.
	const [debounced, setDebounced] = useState({
		accounts: draftAccounts,
		start: draftStart,
		end: draftPolicyEnd,
		noEnd: draftNoEndDate,
	});
	useEffect(() => {
		const timer = setTimeout(
			() =>
				setDebounced({
					accounts: draftAccounts,
					start: draftStart,
					end: draftPolicyEnd,
					noEnd: draftNoEndDate,
				}),
			350,
		);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftAccounts.join(","), draftStart, draftPolicyEnd, draftNoEndDate]);

	const previewInput = useMemo<Omit<SharingPolicyInput, "enabled"> | null>(
		() =>
			debounced.accounts.length > 0 &&
			Boolean(debounced.start) &&
			(debounced.noEnd || Boolean(debounced.end))
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
		() => (grantsQuery.data ?? []).filter((grant) => grant.intent === "shared"),
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
		setAccountIds((current) => {
			const base = current ?? draftAccounts;
			return base.includes(id)
				? base.filter((entry) => entry !== id)
				: [...base, id];
		});
	}

	function draftPolicyInput(enabled: boolean): SharingPolicyInput {
		return {
			enabled,
			accountIds: draftAccounts,
			startDate: draftStart,
			...(draftPolicyEnd ? { endDate: draftPolicyEnd } : {}),
		};
	}

	const canApplyDraft =
		draftAccounts.length > 0 && Boolean(draftStart) && endChoiceValid;

	async function save(input: SharingPolicyInput, notice: string) {
		setSaving(true);
		try {
			await setPolicy.mutateAsync({ groupId, input });
			setAccountIds(null);
			setStartDate(null);
			setEndDate(null);
			setNoEndDate(null);
			notifySuccess("groups-notice", notice);
		} catch (cause) {
			const message = serverMessage(cause, "Sharing could not be saved.");
			notifyError("groups", message);
		} finally {
			setSaving(false);
		}
	}

	function onEnable() {
		void save(draftPolicyInput(true), "Sharing turned on.");
	}

	function onSave() {
		void save(
			draftPolicyInput(policy?.enabled ?? false),
			"Sharing preferences saved.",
		);
	}

	function onDisable() {
		setConfirmStop(false);
		void save(draftPolicyInput(false), "Automatic sharing turned off.");
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
		try {
			await setPolicy.mutateAsync({
				groupId,
				input: draftPolicyInput(false),
			});
			for (const grant of sharedGrants) {
				try {
					await revokeSharedTransaction(
						grant.transactionId,
						grant.audienceType,
						grant.audienceId,
						mintShareRequestId(),
					);
				} catch (cause) {
					// A grant revoked elsewhere reports 404: it is already
					// removed, so continue with the remainder instead of
					// aborting the stop.
					if (cause instanceof ApiError && cause.status === 404) continue;
					throw cause;
				}
			}
			void refreshSharingViewsFor(groupId);
			setAccountIds(null);
			setStartDate(null);
			setEndDate(null);
			setNoEndDate(null);
			setConfirmStop(false);
			notifySuccess("groups-notice", "Stopped sharing with everyone.");
		} catch (cause) {
			// Refresh every sharing view so the visible state matches the
			// server and a retry re-reads from live rows, never a stale list.
			void refreshSharingViewsFor(groupId);
			const message = serverMessage(cause, "Sharing could not be stopped.");
			notifyError("groups", message);
		} finally {
			setStopping(false);
		}
	}

	if (policyQuery.isPending) {
		return (
			<p className="m-0 text-sm text-muted-foreground" role="status">
				Loading sharing…
			</p>
		);
	}

	if (policyQuery.isError) {
		return (
			<InlineError
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
		noEndDate !== null ||
		(policy !== null &&
			(policy.enabled ||
				persistedAccounts.join(",") !== draftAccounts.join(",") ||
				policy.startDate !== draftStart ||
				(policy.endDate ?? "") !== draftPolicyEnd));

	return (
		<section aria-label="My sharing" className="grid gap-4">
			<div>
				<h2 className="m-0 text-base">My sharing</h2>
				<p className="mb-0 text-sm text-muted-foreground">
					{policy?.enabled
						? "Automatic sharing is on for this group."
						: "Automatic sharing is off. Only you can turn it on."}
				</p>
			</div>

			<FieldSet className="grid gap-2">
				<FieldLegend variant="label">Accounts to share</FieldLegend>
				{accounts === null ? (
					<p className="m-0 text-sm text-muted-foreground" role="status">
						Loading accounts…
					</p>
				) : accounts.length === 0 ? (
					<p className="m-0 text-sm text-muted-foreground">
						Add an account to start sharing.
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
			</FieldSet>

			{staleSelections.length > 0 && (
				<Alert role="note">
					<AlertDescription>
						{staleSelections.length} previously selected{" "}
						{staleSelections.length === 1
							? "account no longer"
							: "accounts no longer"}{" "}
						exist, so {staleSelections.length === 1 ? "it was" : "they were"}{" "}
						removed from the selection. Saving keeps it that way.
					</AlertDescription>
				</Alert>
			)}

			<div className="grid max-w-md gap-2">
				<Field>
					<FieldLabel htmlFor={shareFromId}>Share from</FieldLabel>
					<Input
						id={shareFromId}
						type="date"
						value={draftStart}
						maxLength={10}
						onChange={(event) => {
							setStartDate(event.target.value);
						}}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={shareUntilId}>Share until</FieldLabel>
					<Input
						id={shareUntilId}
						type="date"
						value={draftNoEndDate ? "" : draftEnd}
						maxLength={10}
						required={!draftNoEndDate}
						disabled={draftNoEndDate || saving || stopping}
						onChange={(event) => {
							setEndDate(event.target.value);
							setNoEndDate(false);
						}}
					/>
				</Field>
				<Field orientation="horizontal">
					<Checkbox
						id={noEndDateId}
						checked={draftNoEndDate}
						disabled={saving || stopping}
						onCheckedChange={(checked) => {
							const noEnd = checked === true;
							setNoEndDate(noEnd);
							if (noEnd) setEndDate("");
						}}
					/>
					<FieldContent>
						<FieldLabel htmlFor={noEndDateId}>No end date</FieldLabel>
					</FieldContent>
				</Field>
			</div>

			{draftAccounts.length > 0 && (
				<Alert role="note">
					<AlertDescription>
						<p className="m-0 text-foreground">
							<strong>Before sharing.</strong> Matching transactions within
							these dates are shared automatically, including older transactions
							from later bank imports. No second review step.
						</p>
						{!endChoiceValid ? (
							<p className="m-0 text-muted-foreground">
								Choose an end date or No end date to preview matching
								transactions.
							</p>
						) : previewQuery.isPending ? (
							<p className="m-0 text-muted-foreground" role="status">
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
								<p className="m-0">
									{preview.eligibleTransactions}{" "}
									{preview.eligibleTransactions === 1
										? "transaction"
										: "transactions"}{" "}
									across {preview.accountIds.length}{" "}
									{preview.accountIds.length === 1 ? "account" : "accounts"}{" "}
									from {preview.startDate}
									{preview.endDate
										? ` to ${preview.endDate}`
										: " with no end"}{" "}
									match this selection for {preview.memberCount}{" "}
									{preview.memberCount === 1 ? "member" : "members"}. Hidden
									transactions count but stay hidden. Counts only; no amounts or
									payees.
								</p>
							)
						)}
					</AlertDescription>
				</Alert>
			)}

			<div className="flex flex-wrap gap-2">
				{policy?.enabled ? (
					<Button
						variant="secondary"
						size="sm"
						disabled={saving || stopping}
						onClick={onDisable}
					>
						{saving ? "Turning off…" : "Turn off automatic sharing"}
					</Button>
				) : (
					<Button
						variant="default"
						size="sm"
						disabled={saving || stopping || !canApplyDraft}
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
				<p className="m-0 text-sm text-muted-foreground">
					Unsaved changes take effect when sharing turns on.
				</p>
			)}
			{policy?.enabled && dirty && (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						disabled={saving || stopping || !canApplyDraft}
						onClick={onSave}
					>
						{saving ? "Saving…" : "Save changes"}
					</Button>
					<span className="text-sm text-muted-foreground">
						Narrowing dates or accounts revokes access that no longer matches.
					</span>
				</div>
			)}

			<p className="m-0 text-sm text-muted-foreground">
				Share or hide individual transactions in their detail view, regardless
				of automatic sharing. Members keep copies they already accepted.
			</p>
		</section>
	);
}
