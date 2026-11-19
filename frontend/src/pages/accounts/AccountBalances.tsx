import type { BalanceDisplayData } from "./balanceDisplay.ts";
import { dateLabel, money } from "../../domain/format.ts";
import { cn } from "../../lib/utils.ts";

function BalanceFigure({
	label,
	value,
	emphasized,
	emphasis,
}: {
	label: string;
	value: number;
	emphasized: boolean;
	emphasis: "strong" | "plain";
}) {
	return (
		<div className="min-w-0">
			<dt className="text-xs font-medium text-muted-foreground">{label}</dt>
			<dd
				className={
					emphasized
						? emphasis === "plain"
							? "m-0 text-sm font-normal tabular-nums text-foreground"
							: "m-0 text-lg font-semibold tabular-nums text-foreground"
						: "m-0 text-sm tabular-nums text-muted-foreground"
				}
			>
				{money(value)}
			</dd>
		</div>
	);
}

/**
 * Presentational balances for one account. Every rule about which figures
 * exist, which one is emphasized, and whether a sync date is recorded arrives
 * in the data object; this component only renders what it is given. The
 * `columns` prop is styling only: the detail header opts into a fixed two
 * column grid so both figures sit side by side at every width, while the
 * accounts list keeps the default responsive stacking. The `emphasis` prop
 * is styling only: `"plain"` renders an emphasized figure at the table's
 * original size and weight, while the default `"strong"` keeps the display
 * treatment used by the detail header. Non-emphasized figures are unaffected.
 */
export function AccountBalances({
	data,
	columns = 1,
	emphasis = "strong",
}: {
	data: BalanceDisplayData;
	columns?: 1 | 2;
	emphasis?: "strong" | "plain";
}) {
	return (
		<div className="flex w-full min-w-0 flex-col gap-1">
			<dl
				className={cn(
					"m-0 grid w-full min-w-0 gap-x-6 gap-y-2",
					columns === 2 ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2",
				)}
			>
				{data.entries.map((entry) => (
					<BalanceFigure
						key={entry.label}
						label={entry.label}
						value={entry.value}
						emphasized={entry.emphasized}
						emphasis={emphasis}
					/>
				))}
			</dl>
			{data.synced ? (
				<p className="m-0 text-xs text-muted-foreground">
					Last synced{" "}
					<time dateTime={data.synced}>{dateLabel(data.synced, true)}</time>
				</p>
			) : null}
		</div>
	);
}
