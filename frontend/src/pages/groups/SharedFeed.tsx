import { useInfiniteQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope, subscribeUserScope } from "@/auth/resourceScope.ts";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { InputField, SelectField } from "../../components/Field.tsx";
import { dateLabel, exactMoney, isoDateFromEpochSeconds } from "@/domain/format.ts";
import { literalAmountOf } from "@/domain/transactionRows.ts";
import { notifyError, notifySuccess } from "../../state/notifications.ts";
import { serverQueryClient } from "../../state/serverQuery.ts";
import {
	fetchGroupFeed,
	ownerResource,
	saveSharedCopy,
	type FeedDirection,
	type FeedItem,
} from "./sharedFeedApi.ts";
import { mintShareRequestId } from "@/pages/sharingApi.ts";

export interface FeedMember {
	accountId: string;
	displayName: string;
}

const DIRECTION_LABELS: Record<FeedDirection, string> = {
	in: "Money in",
	out: "Money out",
	transfer: "Transfer",
};

function useFeedScope() {
	return useSyncExternalStore(subscribeUserScope, getUserScope);
}

function currentScope(scope: ReturnType<typeof getUserScope>) {
	if (scope !== getUserScope() || scope.status !== "ready")
		throw new UserScopeError();
}

function audienceLabel(item: FeedItem): string {
	return item.audiences
		.map((audience) =>
			audience.type === "direct" ? "Direct share" : audience.name,
		)
		.join(" · ");
}

export function SharedFeed({
	groupId,
	members,
}: {
	groupId: string;
	members: FeedMember[];
}) {
	const scope = useFeedScope();
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [member, setMember] = useState("");
	const [direction, setDirection] = useState("" as "" | FeedDirection);
	const [saving, setSaving] = useState<string | null>(null);
	const [saved, setSaved] = useState<Record<string, boolean>>({});

	const filtersKey = { startDate, endDate, member, direction };
	const feedQuery = useInfiniteQuery(
		{
			queryKey: [
				"user-resources",
				scope.key,
				"group-feed",
				groupId,
				filtersKey,
			] as const,
			enabled: scope.status === "ready",
			initialPageParam: "",
			queryFn: async ({ signal, pageParam }) => {
				currentScope(scope);
				return fetchGroupFeed(
					groupId,
					{
						startDate: startDate || undefined,
						endDate: endDate || undefined,
						members: member ? [ownerResource(member)] : undefined,
						directions: direction ? [direction] : undefined,
						limit: 20,
						cursor: pageParam || undefined,
					},
					signal,
				);
			},
			getNextPageParam: (lastPage) =>
				lastPage.page.hasMore ? lastPage.page.nextCursor : undefined,
		},
		serverQueryClient(),
	);

	const pages = feedQuery.data?.pages ?? [];
	const items = pages.flatMap((page) => page.items);
	const totals = pages.at(-1)?.totals ?? null;

	async function onSave(item: FeedItem) {
		const key = `${item.ownerUserId}/${item.posting.id}`;
		const requestId = mintShareRequestId();
		setSaving(key);
		try {
			await saveSharedCopy(item.ownerUserId, item.posting.id, requestId);
			setSaved((previous) => ({ ...previous, [key]: true }));
			notifySuccess("groups-notice", "Saved to your transactions.");
		} catch {
			notifyError("groups", "The copy could not be saved.");
		} finally {
			setSaving((current) => (current === key ? null : current));
		}
	}

	return (
		<section aria-label="Shared transactions" className="grid gap-4">
			<div>
				<h3 className="m-0 text-base">Shared transactions</h3>
				{totals && (
					<p className="mb-0 text-sm text-muted" role="status">
						{totals.count} transaction{totals.count === 1 ? "" : "s"} ·{" "}
						{exactMoney(totals.totalAmount)} shared
						{totals.varyingCount > 0 &&
							` · ${totals.varyingCount} calculated amount${totals.varyingCount === 1 ? "" : "s"} not summed`}
						{totals.pendingCount > 0 &&
							` · ${totals.pendingCount} pending`}
					</p>
				)}
			</div>

			<form
				className="grid gap-2 sm:grid-cols-2"
				onSubmit={(event) => event.preventDefault()}
			>
				<InputField
					label="From date"
					type="date"
					value={startDate}
					onChange={(event) => setStartDate(event.target.value)}
				/>
				<InputField
					label="To date"
					type="date"
					value={endDate}
					onChange={(event) => setEndDate(event.target.value)}
				/>
				<SelectField
					label="Member"
					value={member}
					onChange={(event) => setMember(event.target.value)}
				>
					<option value="">Everyone</option>
					{members.map((entry) => (
						<option key={entry.accountId} value={entry.accountId}>
							{entry.displayName || entry.accountId}
						</option>
					))}
				</SelectField>
				<SelectField
					label="Movement"
					value={direction}
					onChange={(event) =>
						setDirection(event.target.value as "" | FeedDirection)
					}
				>
					<option value="">All movements</option>
					{(Object.keys(DIRECTION_LABELS) as FeedDirection[]).map(
						(value) => (
							<option key={value} value={value}>
								{DIRECTION_LABELS[value]}
							</option>
						),
					)}
				</SelectField>
			</form>

			{feedQuery.isError && (
				<ErrorNotice
					message="Shared transactions could not be loaded."
					action="Retry"
					onAction={() => void feedQuery.refetch()}
				/>
			)}

			{!feedQuery.isError && items.length === 0 && !feedQuery.isPending && (
				<EmptyState
					icon={Users}
					title="No shared transactions"
					description="Nothing shared in this group matches these filters."
				/>
			)}

			{items.length > 0 && (
				<ul className="grid list-none gap-2 p-0">
					{items.map((item) => {
						const key = `${item.ownerUserId}/${item.posting.id}`;
						const literal = literalAmountOf(item.posting.amount);
						const day = isoDateFromEpochSeconds(
							item.posting.transactionTime,
						);
						return (
							<li
								key={key}
								className="grid gap-1 rounded-control border border-solid border-line px-3 py-2 text-sm"
							>
								<span className="flex items-center justify-between gap-3">
									<strong>{item.posting.name}</strong>
									<span>{literal === null ? "Varies" : exactMoney(literal)}</span>
								</span>
								<span className="text-muted">
									Shared by {item.sourceDisplayName} ·{" "}
									{audienceLabel(item)} · {dateLabel(day, true)}
									{item.posting.pending ? " · Pending" : ""}
								</span>
								<span>
									{saved[key] ? (
										<span className="text-muted" role="status">
											Saved to your transactions
										</span>
									) : (
										<Button
											variant="ghost"
											size="sm"
											disabled={saving === key}
											onClick={() => void onSave(item)}
										>
											{saving === key
												? "Saving…"
												: `Save a copy of ${item.posting.name}`}
										</Button>
									)}
								</span>
							</li>
						);
					})}
				</ul>
			)}

			{feedQuery.hasNextPage && (
				<div>
					<Button
						variant="secondary"
						size="sm"
						disabled={feedQuery.isFetchingNextPage}
						onClick={() => void feedQuery.fetchNextPage()}
					>
						{feedQuery.isFetchingNextPage
							? "Loading…"
							: "Show more shared transactions"}
					</Button>
				</div>
			)}
		</section>
	);
}
