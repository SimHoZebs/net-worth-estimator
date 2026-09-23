import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import { MoneyRow } from "./MoneyRow";
import { type MoneyDirection, moneyDirection } from "./money";

const PAGE_SIZE = 30;

export function MoneyFeed({
	postings,
	accounts,
	emptyText,
	onOpen,
	groupByDate = false,
	dateDescending = true,
}: {
	postings: Posting[];
	accounts: Account[];
	emptyText: string;
	onOpen: (posting: Posting) => void;
	groupByDate?: boolean;
	dateDescending?: boolean;
}) {
	const accountById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<MoneyDirection | "all">("all");
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

	const normalized = query.trim().toLowerCase();
	const filtered = postings.filter((posting) => {
		if (filter !== "all" && moneyDirection(posting) !== filter) return false;
		if (!normalized) return true;
		const accountIds = [
			posting.sourceAccountId,
			...(posting.destinations ?? []),
		].filter((id): id is string => id !== null);
		return [
			posting.label,
			posting.id,
			...accountIds,
			...accountIds.map((id) => accountById.get(id)?.label ?? ""),
		].some((value) => value.toLowerCase().includes(normalized));
	});

	const sorted = useMemo(() => {
		const copy = [...filtered];
		copy.sort((a, b) =>
			dateDescending
				? b.startDate.localeCompare(a.startDate)
				: a.startDate.localeCompare(b.startDate),
		);
		return copy;
	}, [filtered, dateDescending]);
	const visible = sorted.slice(0, visibleCount);

	const groups = useMemo(() => {
		if (!groupByDate) return null;
		const byDate = new Map<string, Posting[]>();
		for (const posting of visible) {
			const group = byDate.get(posting.startDate) ?? [];
			group.push(posting);
			byDate.set(posting.startDate, group);
		}
		return Array.from(byDate, ([date, rows]) => ({ date, rows }));
	}, [visible, groupByDate]);

	const chips: { id: MoneyDirection | "all"; label: string }[] = [
		{ id: "all", label: "All" },
		{ id: "in", label: "In" },
		{ id: "out", label: "Out" },
		{ id: "transfer", label: "Transfers" },
	];

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-2">
				<input
					type="search"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setVisibleCount(PAGE_SIZE);
					}}
					placeholder="Search"
					aria-label="Search"
					className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2 type-body placeholder:text-muted-foreground sm:max-w-xs"
				/>
				<fieldset className="flex flex-wrap gap-1.5">
					<legend className="sr-only">Filter by direction</legend>
					{chips.map((chip) => (
						<button
							key={chip.id}
							type="button"
							aria-pressed={filter === chip.id}
							onClick={() => {
								setFilter(chip.id);
								setVisibleCount(PAGE_SIZE);
							}}
							className={`rounded-full px-3 py-1.5 type-caption font-medium transition ${
								filter === chip.id
									? "bg-primary text-primary-foreground shadow-sm"
									: "border border-border/80 text-muted-foreground hover:text-foreground"
							}`}
						>
							{chip.label}
						</button>
					))}
				</fieldset>
			</div>

			{visible.length === 0 ? (
				<p className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center type-muted">
					{emptyText}
				</p>
			) : groups ? (
				<div className="space-y-5">
					{groups.map((group) => (
						<section key={group.date} aria-label={group.date}>
							<div className="mb-1.5 px-1 type-label text-muted-foreground">
								{formatDate(group.date)}
							</div>
							<div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/80 bg-card/70">
								{group.rows.map((posting) => (
									<MoneyRow
										key={posting.id}
										posting={posting}
										accountById={accountById}
										onOpen={onOpen}
									/>
								))}
							</div>
						</section>
					))}
				</div>
			) : (
				<div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/80 bg-card/70">
					{visible.map((posting) => (
						<MoneyRow
							key={posting.id}
							posting={posting}
							accountById={accountById}
							onOpen={onOpen}
						/>
					))}
				</div>
			)}

			{sorted.length > visible.length ? (
				<div className="flex justify-center">
					<button
						type="button"
						onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
						className="rounded-full border border-border px-4 py-2 type-caption font-medium hover:border-ring"
					>
						Show more ({sorted.length - visible.length})
					</button>
				</div>
			) : null}
		</div>
	);
}
