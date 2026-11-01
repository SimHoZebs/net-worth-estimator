import { Inbox } from "lucide-react";
import { useState } from "react";
import type { Posting } from "@/api/contracts.ts";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorNotice } from "../components/ErrorNotice.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { dateLabel, isoDateFromEpochSeconds, money } from "../domain/format.ts";
import { literalAmountOf } from "../domain/transactionRows.ts";
import type { InboxShareItem, InboxStatus } from "./inboxApi.ts";
import {
	useAcceptInboxShare,
	useDeclineInboxShare,
	useDismissInboxShare,
	useInbox,
	useMarkInboxShareRead,
	useMarkInboxShareUnread,
	useUndismissInboxShare,
} from "../state/inbox.ts";
import { notifyError, notifySuccess } from "../state/notifications.ts";

/** Stored literal figure from a shared amount, or null for recipes. */
function previewAmount(posting: Posting): number | null {
	return literalAmountOf(posting.amount);
}

const tabs: Array<{ id: InboxStatus; label: string }> = [
	{ id: "pending", label: "Pending" },
	{ id: "accepted", label: "Accepted" },
	{ id: "declined", label: "Declined" },
	{ id: "canceled", label: "Canceled" },
];

const statusTone: Record<InboxStatus, "outline" | "success" | "neutral" | "warning"> = {
	pending: "outline",
	accepted: "success",
	declined: "neutral",
	canceled: "warning",
};

const emptyCopy: Record<InboxStatus, { title: string; description: string }> = {
	pending: {
		title: "Nothing waiting",
		description:
			"Transactions people share with you land here, along with split requests once sending arrives.",
	},
	accepted: {
		title: "Nothing accepted yet",
		description: "Accepted shares keep their own copy in your records.",
	},
	declined: {
		title: "Nothing declined",
		description:
			"Declining a direct share removes you from the sender's sharing list.",
	},
	canceled: {
		title: "Nothing taken back",
		description: "Shares the sender takes back before you decide land here.",
	},
};

function InboxItemCard({
	item,
	busy,
	onAccept,
	onDecline,
	onDismiss,
	onUndismiss,
	onMarkRead,
	onMarkUnread,
}: {
	item: InboxShareItem;
	busy: boolean;
	onAccept: () => void;
	onDecline: () => void;
	onDismiss: () => void;
	onUndismiss: () => void;
	onMarkRead: () => void;
	onMarkUnread: () => void;
}) {
	const posting = item.posting;
	const amount = posting ? previewAmount(posting) : null;
	return (
		<article aria-label={`Shared transaction ${item.postingId}`} className="grid gap-2 rounded-surface border border-solid border-line bg-surface p-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone={statusTone[item.status]}>{item.status}</Badge>
				{item.unread && <Badge tone="success">New</Badge>}
				{item.dismissed && <Badge tone="neutral">Hidden</Badge>}
			</div>
			<div>
				<h3 className="m-0 text-base">{posting?.name ?? "Shared transaction"}</h3>
				<p className="mt-1 mb-0 text-sm text-muted">
					{item.senderDisplayName
						? `Shared by ${item.senderDisplayName}`
						: "Shared with you"}
					{posting
						? ` · ${dateLabel(isoDateFromEpochSeconds(posting.postedTime), true)}`
						: ""}
				</p>
			</div>
			{posting ? (
				<p className="m-0 text-sm">
					{amount != null ? <strong>{money(amount)}</strong> : "Varies"}
				</p>
			) : (
				<p className="m-0 text-sm text-muted">
					{item.status === "canceled"
						? "This share was taken back before you decided."
						: "This share is no longer available to view."}
				</p>
			)}
			{item.status === "accepted" && item.copyPostingId && (
				<p className="m-0 text-sm text-muted">
					Saved to your own records as an independent copy.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{item.status === "pending" && posting && (
					<>
						<Button size="sm" variant="primary" disabled={busy} onClick={onAccept}>
							Accept and save a copy
						</Button>
						<Button size="sm" disabled={busy} onClick={onDecline}>
							Decline
						</Button>
					</>
				)}
				{item.dismissed ? (
					<Button size="sm" variant="ghost" disabled={busy} onClick={onUndismiss}>
						Unhide
					</Button>
				) : (
					<Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
						Hide
					</Button>
				)}
				{item.unread ? (
					<Button size="sm" variant="ghost" disabled={busy} onClick={onMarkRead}>
						Mark read
					</Button>
				) : (
					<Button size="sm" variant="ghost" disabled={busy} onClick={onMarkUnread}>
						Mark unread
					</Button>
				)}
			</div>
		</article>
	);
}

export function InboxPage() {
	const [filter, setFilter] = useState<InboxStatus>("pending");
	const [showDismissed, setShowDismissed] = useState(false);
	const inboxQuery = useInbox(filter, showDismissed);
	const items = inboxQuery.data?.items ?? [];
	const acceptMutation = useAcceptInboxShare();
	const declineMutation = useDeclineInboxShare();
	const dismissMutation = useDismissInboxShare();
	const undismissMutation = useUndismissInboxShare();
	const markReadMutation = useMarkInboxShareRead();
	const markUnreadMutation = useMarkInboxShareUnread();
	const busy =
		acceptMutation.isPending ||
		declineMutation.isPending ||
		dismissMutation.isPending ||
		undismissMutation.isPending ||
		markReadMutation.isPending ||
		markUnreadMutation.isPending;

	function target(item: InboxShareItem) {
		return { ownerUserId: item.ownerUserId, postingId: item.postingId };
	}

	async function onAccept(item: InboxShareItem) {
		try {
			await acceptMutation.mutateAsync(target(item));
			notifySuccess("inbox-notice", "Share accepted and saved to your records.");
		} catch {
			notifyError("inbox", "Share could not be accepted.");
		}
	}

	async function onDecline(item: InboxShareItem) {
		try {
			await declineMutation.mutateAsync(target(item));
			notifySuccess("inbox-notice", "Share declined.");
		} catch {
			notifyError("inbox", "Share could not be declined.");
		}
	}

	async function onDismiss(item: InboxShareItem) {
		try {
			await dismissMutation.mutateAsync(target(item));
			notifySuccess("inbox-notice", "Share hidden. Unhide it any time.");
		} catch {
			notifyError("inbox", "Share could not be hidden.");
		}
	}

	async function onUndismiss(item: InboxShareItem) {
		try {
			await undismissMutation.mutateAsync(target(item));
			notifySuccess("inbox-notice", "Share restored.");
		} catch {
			notifyError("inbox", "Share could not be restored.");
		}
	}

	async function onMarkRead(item: InboxShareItem) {
		try {
			await markReadMutation.mutateAsync(target(item));
		} catch {
			notifyError("inbox", "Share could not be marked read.");
		}
	}

	async function onMarkUnread(item: InboxShareItem) {
		try {
			await markUnreadMutation.mutateAsync(target(item));
		} catch {
			notifyError("inbox", "Share could not be marked unread.");
		}
	}

	const empty = emptyCopy[filter];

	return (
		<section aria-label="Inbox" className="grid gap-6">
			<div>
				<h2 className="m-0 text-xl">Inbox</h2>
				<p className="mb-0 text-sm text-muted">
					One place for transactions shared with you. Accepting saves your
					own copy; declining removes you from the sender&apos;s list.
				</p>
			</div>
			{inboxQuery.isError ? (
				<ErrorNotice message="Inbox could not be loaded." />
			) : (
				<>
					<Tabs items={tabs} value={filter} onChange={setFilter} label="Inbox status">
						<div>
							<label className="mb-4 flex items-center gap-2 text-sm text-muted">
								<input
									type="checkbox"
									checked={showDismissed}
									onChange={(event) => setShowDismissed(event.target.checked)}
								/>
								Show hidden items
							</label>
							{inboxQuery.isPending ? (
								<p className="text-sm text-muted">Loading inbox…</p>
							) : items.length === 0 ? (
								<EmptyState
									icon={Inbox}
									title={empty.title}
									description={empty.description}
								/>
							) : (
								<div className="grid gap-3">
									{items.map((item) => (
										<InboxItemCard
											key={`${item.ownerUserId}/${item.postingId}`}
											item={item}
											busy={busy}
											onAccept={() => void onAccept(item)}
											onDecline={() => void onDecline(item)}
											onDismiss={() => void onDismiss(item)}
											onUndismiss={() => void onUndismiss(item)}
											onMarkRead={() => void onMarkRead(item)}
											onMarkUnread={() => void onMarkUnread(item)}
										/>
									))}
								</div>
							)}
						</div>
					</Tabs>
				</>
			)}
		</section>
	);
}
