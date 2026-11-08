import { useInfiniteQuery } from "@tanstack/react-query";
import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	Users,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope, subscribeUserScope } from "@/auth/resourceScope.ts";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { InputField, SelectField } from "../../components/Field.tsx";
import { TransactionItemRow } from "../../components/activity/TransactionItem.tsx";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import {
	transactionAmountStyles,
	transactionBadgeStyles,
} from "../../components/activity/activityStyles.ts";
import {
	dateLabel,
	exactMoney,
	isoDateFromEpochSeconds,
} from "@/domain/format.ts";
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
		const key = `${item.ownerUserId}/${item.transaction.id}`;
		const requestId = mintShareRequestId();
		setSaving(key);
		try {
			await saveSharedCopy(item.ownerUserId, item.transaction.id, requestId);
			setSaved((previous) => ({ ...previous, [key]: true }));
			notifySuccess("groups-notice", "Saved to your transactions.");
		} catch {
			notifyError("groups", "The copy could not be saved.");
		} finally {
			setSaving((current) => (current === key ? null : current));
		}
	}

	return (
		<section aria-label="Shared feed" className="grid gap-4">
			<div>
				<h3 className="m-0 text-base">Shared transactions</h3>
				{totals && (
					<p className="mb-0 text-sm text-muted" role="status">
						{totals.count} transaction{totals.count === 1 ? "" : "s"} ·{" "}
						{exactMoney(totals.totalAmount)} shared
						{totals.varyingCount > 0 &&
							` · ${totals.varyingCount} calculated amount${totals.varyingCount === 1 ? "" : "s"} not summed`}
						{totals.pendingCount > 0 && ` · ${totals.pendingCount} pending`}
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
					{(Object.keys(DIRECTION_LABELS) as FeedDirection[]).map((value) => (
						<option key={value} value={value}>
							{DIRECTION_LABELS[value]}
						</option>
					))}
				</SelectField>
			</form>

			<ErrorNotice
				message={
					feedQuery.isError ? "Shared transactions could not be loaded." : null
				}
				action="Retry"
				onAction={() => void feedQuery.refetch()}
			/>

			{!feedQuery.isError && items.length === 0 && !feedQuery.isPending && (
				<EmptyState
					icon={Users}
					title="No shared transactions"
					description="Nothing shared in this group matches these filters."
				/>
			)}

			{items.length > 0 && (
				<TransactionTable caption="Shared transactions">
					{items.map((item) => {
						const key = `${item.ownerUserId}/${item.transaction.id}`;
						const literal = literalAmountOf(item.transaction.amount);
						const day = isoDateFromEpochSeconds(
							item.transaction.transactionTime,
						);
						const from = item.transaction.sourceAccountId;
						const to = item.transaction.destinations;
						const tone = from
							? to.length > 0
								? ("transfer" as const)
								: ("outflow" as const)
							: ("inflow" as const);
						const DirectionIcon =
							tone === "transfer"
								? ArrowRightLeft
								: tone === "inflow"
									? ArrowDownLeft
									: ArrowUpRight;
						const isSaved = saved[key] === true;
						const busy = saving === key;
						return (
							<TransactionItemRow
								key={key}
								date={<time dateTime={day}>{dateLabel(day, true)}</time>}
								icon={<DirectionIcon size={16} aria-hidden="true" />}
								tone={tone}
								title={item.transaction.name}
								slots={{
									subtitle: (
										<span>
											Shared by {item.sourceDisplayName} · {audienceLabel(item)}
										</span>
									),
									mobile: <time dateTime={day}>{dateLabel(day, true)}</time>,
									badges: isSaved ? (
										<Badge
											tone="neutral"
											className={transactionBadgeStyles()}
										>
											Saved
										</Badge>
									) : null,
								}}
								amount={
									<>
										{literal === null ? (
											<strong
												className={transactionAmountStyles()}
												title="Shared amount is calculated"
											>
												Varies
											</strong>
										) : (
											<strong
												className={transactionAmountStyles({
													positive: tone === "inflow",
												})}
											>
												{tone === "inflow"
													? `+${exactMoney(literal)}`
													: tone === "outflow"
														? `−${exactMoney(literal)}`
														: exactMoney(literal)}
											</strong>
										)}
										{item.transaction.pending ? (
											<Badge
												tone="neutral"
												className={transactionBadgeStyles()}
											>
												Pending
											</Badge>
										) : null}
									</>
								}
								actionLabel={`Save a copy of ${item.transaction.name} on ${dateLabel(day, true)}${item.transaction.pending ? "; pending" : ""}${busy ? "; saving" : ""}`}
								onSelect={() => void onSave(item)}
								selectDisabled={isSaved || busy}
							/>
						);
					})}
				</TransactionTable>
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
