import { currency } from "@/lib/format";
import {
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/posting-categories";
import {
	type Account,
	describePostingAmount,
	getExpression,
	type Posting,
} from "@/lib/projection";
import { AccountChip } from "./AccountIdentity";

type TransactionEffect = "inflow" | "outflow" | "transfer";

function transactionEffect(posting: Posting): TransactionEffect {
	if (!posting.sourceAccountId && posting.destinations?.length) return "inflow";
	if (posting.sourceAccountId && posting.destinations === null)
		return "outflow";
	return "transfer";
}

export function transactionMatchesSearch(
	posting: Posting,
	accountById: ReadonlyMap<string, Account>,
	query: string,
) {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return true;
	const accountIds = [
		posting.sourceAccountId,
		...(posting.destinations ?? []),
	].filter((id): id is string => id !== null);
	return [
		posting.id,
		posting.label,
		...accountIds,
		...accountIds.map((id) => accountById.get(id)?.label ?? ""),
	].some((value) => value.toLowerCase().includes(normalized));
}

export function TransactionListRow({
	posting,
	accountById,
	meta,
	technical,
}: {
	posting: Posting;
	accountById: ReadonlyMap<string, Account>;
	meta?: ReactNode;
	technical?: ReactNode;
}) {
	return (
		<div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)_auto] sm:items-center sm:gap-5">
			<div className="min-w-0">
				<div className="type-value break-words [overflow-wrap:anywhere]">
					{posting.label}
				</div>
				{meta ? <div className="mt-0.5 type-caption">{meta}</div> : null}
				{technical ? <div className="mt-1 type-code">{technical}</div> : null}
			</div>
			<div className="sm:flex sm:justify-end">
				<TransactionRoute posting={posting} accountById={accountById} />
			</div>
			<div className="sm:text-right">
				<TransactionAmount posting={posting} />
			</div>
		</div>
	);
}

export function TransactionRoute({
	posting,
	accountById,
}: {
	posting: Posting;
	accountById: ReadonlyMap<string, Account>;
}) {
	const source = posting.sourceAccountId
		? accountById.get(posting.sourceAccountId)
		: null;
	const destinations =
		posting.destinations?.map((id) => accountById.get(id)) ?? null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			{posting.sourceAccountId === null ? (
				<ExternalChip />
			) : source ? (
				<AccountChip account={source} />
			) : (
				<UnresolvedAccountChip id={posting.sourceAccountId} />
			)}
			<span aria-hidden="true" className="text-muted-foreground">
				→
			</span>
			<span className="sr-only">to</span>
			{destinations === null ? (
				<ExternalChip />
			) : (
				destinations.map((account, index) =>
					account ? (
						<AccountChip key={account.id} account={account} />
					) : (
						<UnresolvedAccountChip
							key={posting.destinations?.[index]}
							id={posting.destinations?.[index] ?? "Unknown account"}
						/>
					),
				)
			)}
		</div>
	);
}

export function TransactionAmount({ posting }: { posting: Posting }) {
	const effect = transactionEffect(posting);
	const tone =
		effect === "inflow"
			? "text-[color:var(--chart-success)]"
			: effect === "outflow"
				? "text-destructive"
				: "text-foreground";
	const prefix = effect === "inflow" ? "+" : effect === "outflow" ? "-" : "";
	const expression = getExpression(posting);
	if (expression !== null && isNumericArithmetic(expression)) {
		const amount = parseNumericArithmetic(expression);
		if (amount <= 0) {
			return (
				<div className="text-muted-foreground">
					<div className="type-value tabular-nums">{currency.format(0)}</div>
					<div className="type-caption">No movement</div>
				</div>
			);
		}
		return (
			<div className={`type-value tabular-nums ${tone}`}>
				{prefix}
				{currency.format(Math.abs(amount))}
			</div>
		);
	}
	return (
		<div className={tone}>
			<div className="type-code break-all whitespace-normal">
				{prefix}
				{describePostingAmount(posting)}
			</div>
			<div className="type-caption">Calculated {effect}</div>
		</div>
	);
}

function ExternalChip() {
	return (
		<span className="rounded-full border border-dashed border-border px-2.5 py-1 type-caption">
			External
		</span>
	);
}

function UnresolvedAccountChip({ id }: { id: string }) {
	return (
		<span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 type-caption type-code">
			{id}
		</span>
	);
}

import type { ReactNode } from "react";
