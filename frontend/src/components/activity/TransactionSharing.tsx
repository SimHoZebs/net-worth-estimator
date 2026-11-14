import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import {
	Field,
	FieldLabel,
	FieldDescription,
	FieldError,
} from "@/components/ui/field.tsx";
import {
	Item,
	ItemContent,
	ItemActions,
	ItemGroup,
} from "@/components/ui/item.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { notifySuccess } from "../../state/notifications.ts";
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
	const shareTargetLabel = (value: string | null): string =>
		!value ? "Choose a group…" : groupName(value);
	const hideTargetLabel = (value: string | null): string => {
		if (!value) return "Choose who…";
		if (value === "all") return "Everyone, including future groups";
		return groupName(value);
	};

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

	// The drawer blocks toasts. It owns failures inline.
	function failureMessage(cause: unknown, fallback: string): string {
		const message =
			cause instanceof Error && cause.message ? cause.message : fallback;
		setError(message);
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
			<p className="m-0 text-sm text-muted-foreground" role="status">
				Loading sharing…
			</p>
		);
	}

	if (grantsQuery.isError || groupsQuery.isError) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Sharing could not be loaded.</AlertTitle>
				<AlertDescription className="flex flex-wrap items-center gap-2 pt-2">
					<Button
						variant="link"
						onClick={() => {
							void grantsQuery.refetch();
							void groupsQuery.refetch();
						}}
					>
						Retry
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<section aria-label="Sharing" className="grid gap-3">
			<div>
				<h3 className="m-0 text-sm font-medium">Sharing</h3>
			</div>

			{error && <FieldError>{error}</FieldError>}

			{intents.length > 0 && (
				<ItemGroup>
					{intents.map((intent) => (
						<Item
							key={`${intent.audienceType}:${intent.audienceId}`}
							variant="outline"
							size="sm"
						>
							<ItemContent>
								{intent.intent === "shared" ? (
									<>
										Shared with <strong>{groupName(intent.audienceId)}</strong>
										{wildcardHidden && (
											<span className="text-muted-foreground">
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
							</ItemContent>
							{!readOnly && (
								<ItemActions>
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
								</ItemActions>
							)}
						</Item>
					))}
				</ItemGroup>
			)}

			{!readOnly && (
				<div className="grid gap-3">
					<Field>
						<FieldLabel htmlFor={`share-group-${transactionId}`}>
							Share with a group
						</FieldLabel>
						<FieldDescription>
							The group sees this transaction in its usual shape. Works with or
							without automatic sharing.
						</FieldDescription>
						<div className="flex flex-wrap gap-2">
							<Select
								value={shareTarget}
								disabled={busy || wildcardHidden || shareOptions.length === 0}
								onValueChange={(value) => {
									setError(null);
									if (value !== null) setShareTarget(value);
								}}
							>
								<SelectTrigger
									id={`share-group-${transactionId}`}
									aria-label="Share with a group"
								>
									<SelectValue placeholder="Choose a group…">
										{(value: string | null) => shareTargetLabel(value)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{shareOptions.map((group) => (
										<SelectItem key={group.id} value={group.id}>
											{group.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								size="sm"
								disabled={busy || wildcardHidden || !shareTarget}
								onClick={onShare}
							>
								{busy ? "Sharing…" : "Share"}
							</Button>
						</div>
						{wildcardHidden && (
							<p className="m-0 text-sm text-muted-foreground">
								Sharing is paused while this transaction is hidden from
								everyone. Remove that exclusion to share again.
							</p>
						)}
					</Field>

					<Field>
						<FieldLabel htmlFor={`hide-group-${transactionId}`}>
							Hide from a group or everyone
						</FieldLabel>
						<FieldDescription>
							Hiding wins over sharing. Hiding from everyone also covers groups
							you join later and stays until removed.
						</FieldDescription>
						<div className="flex flex-wrap gap-2">
							<Select
								value={hideTarget}
								disabled={busy || (wildcardHidden && hideOptions.length === 0)}
								onValueChange={(value) => {
									setError(null);
									if (value !== null) setHideTarget(value);
								}}
							>
								<SelectTrigger
									id={`hide-group-${transactionId}`}
									aria-label="Hide from a group or everyone"
								>
									<SelectValue placeholder="Choose who…">
										{(value: string | null) => hideTargetLabel(value)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{hideOptions.map((group) => (
										<SelectItem key={group.id} value={group.id}>
											{group.name}
										</SelectItem>
									))}
									{!wildcardHidden && (
										<SelectItem value="all">
											Everyone, including future groups
										</SelectItem>
									)}
								</SelectContent>
							</Select>
							<Button
								size="sm"
								variant="secondary"
								disabled={busy || !hideTarget}
								onClick={onHide}
							>
								{busy ? "Hiding…" : "Hide"}
							</Button>
						</div>
					</Field>
				</div>
			)}
		</section>
	);
}
