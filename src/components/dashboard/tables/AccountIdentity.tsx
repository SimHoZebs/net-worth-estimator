import type { Account } from "@/lib/projection";

export function AccountIdentity({ account }: { account: Account }) {
	return (
		<span className="inline-flex min-w-0 items-center gap-2">
			<span
				aria-hidden="true"
				className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 shadow-sm"
				style={{ backgroundColor: account.color ?? "var(--muted-foreground)" }}
			/>
			<span className="break-words [overflow-wrap:anywhere]">
				{account.label}
			</span>
		</span>
	);
}

export function AccountChip({ account }: { account: Account }) {
	return (
		<span
			className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card/85 px-2.5 py-1 type-caption type-value break-words [overflow-wrap:anywhere]"
			style={{ borderColor: account.color ?? undefined }}
		>
			<span
				aria-hidden="true"
				className="h-2 w-2 shrink-0 rounded-full"
				style={{ backgroundColor: account.color ?? "var(--muted-foreground)" }}
			/>
			{account.label}
		</span>
	);
}
