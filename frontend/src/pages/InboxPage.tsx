import { Inbox } from "lucide-react";
import { useId, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Transaction } from "@/api/contracts.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { cn } from "@/lib/utils.ts";
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
function previewAmount(transaction: Transaction): number | null {
	return literalAmountOf(transaction.amount);
}

const tabs: Array<{ id: InboxStatus; label: string }> = [
	{ id: "pending", label: "Pending" },
	{ id: "accepted", label: "Accepted" },
	{ id: "declined", label: "Declined" },
	{ id: "canceled", label: "Canceled" },
];

const statusVariant: Record<
	InboxStatus,
	{ variant: "outline" | "default" | "secondary"; className?: string }
> = {
	pending: { variant: "outline" },
	accepted: {
		variant: "default",
		className: "bg-success-bg text-success-text",
	},
	declined: { variant: "secondary" },
	canceled: {
		variant: "default",
		className: "bg-warning-bg text-warning-text",
	},
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
	const transaction = item.transaction;
	const amount = transaction ? previewAmount(transaction) : null;
	return (
		<article
			aria-label={`Shared transaction ${item.transactionId}`}
			className="grid gap-2 rounded-surface border border-solid border-line bg-surface p-4"
		>
			<div className="flex flex-wrap items-center gap-2">
				<Badge
					variant={statusVariant[item.status].variant}
					className={cn("capitalize", statusVariant[item.status].className)}
				>
					{item.status}
				</Badge>
				{item.unread && (
					<Badge variant="default" className="bg-success-bg text-success-text">
						New
					</Badge>
				)}
				{item.dismissed && <Badge variant="secondary">Hidden</Badge>}
			</div>
			<div>
				<h3 className="m-0 text-base">
					{transaction?.name ?? "Shared transaction"}
				</h3>
				<p className="mt-1 mb-0 text-sm text-muted">
					{item.senderDisplayName
						? `Shared by ${item.senderDisplayName}`
						: "Shared with you"}
					{transaction
						? ` · ${dateLabel(isoDateFromEpochSeconds(transaction.postedTime), true)}`
						: ""}
				</p>
			</div>
			{transaction ? (
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
			{item.status === "accepted" && item.copyTransactionId && (
				<p className="m-0 text-sm text-muted">
					Saved to your own records as an independent copy.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{item.status === "pending" && transaction && (
					<>
						<Button
							size="sm"
							variant="default"
							disabled={busy}
							onClick={onAccept}
						>
							Accept and save a copy
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={busy}
							onClick={onDecline}
						>
							Decline
						</Button>
					</>
				)}
				{item.dismissed ? (
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={onUndismiss}
					>
						Unhide
					</Button>
				) : (
					<Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
						Hide
					</Button>
				)}
				{item.unread ? (
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={onMarkRead}
					>
						Mark read
					</Button>
				) : (
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={onMarkUnread}
					>
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
	const showDismissedId = useId();
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
		return { ownerUserId: item.ownerUserId, transactionId: item.transactionId };
	}

	async function onAccept(item: InboxShareItem) {
		try {
			await acceptMutation.mutateAsync(target(item));
			notifySuccess(
				"inbox-notice",
				"Share accepted and saved to your records.",
			);
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
					One place for transactions shared with you. Accepting saves your own
					copy; declining removes you from the sender&apos;s list.
				</p>
			</div>
			{inboxQuery.isError ? (
				<Alert variant="destructive">
					<AlertCircle size={16} aria-hidden="true" />
					<AlertDescription>
						Inbox could not be loaded.{" "}
						<Button variant="link" onClick={() => void inboxQuery.refetch()}>
							Retry
						</Button>
					</AlertDescription>
				</Alert>
			) : (
				<Tabs
					value={filter}
					onValueChange={(next) => setFilter(next as InboxStatus)}
				>
					<TabsList
						variant="line"
						aria-label="Inbox status"
						className="mb-6 flex w-full gap-6 overflow-x-auto border-0 border-b border-solid border-line p-0"
					>
						{tabs.map((tab) => (
							<TabsTrigger
								key={tab.id}
								value={tab.id}
								className="flex-none px-0.5 pt-3 pb-4"
							>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
					<TabsContent value={filter}>
						<div>
							<div className="mb-4 flex items-center gap-2 text-sm text-muted">
								<Checkbox
									id={showDismissedId}
									checked={showDismissed}
									onCheckedChange={(checked) =>
										setShowDismissed(checked === true)
									}
								/>
								<Label htmlFor={showDismissedId}>Show hidden items</Label>
							</div>
							{inboxQuery.isPending ? (
								<p className="text-sm text-muted">Loading inbox…</p>
							) : items.length === 0 ? (
								<Empty>
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<Inbox aria-hidden="true" />
										</EmptyMedia>
										<EmptyTitle>{empty.title}</EmptyTitle>
										<EmptyDescription>{empty.description}</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : (
								<div className="grid gap-3">
									{items.map((item) => (
										<InboxItemCard
											key={`${item.ownerUserId}/${item.transactionId}`}
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
					</TabsContent>
				</Tabs>
			)}
		</section>
	);
}
