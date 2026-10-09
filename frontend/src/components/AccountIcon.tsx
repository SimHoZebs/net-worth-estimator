import {
	Building2,
	Home,
	Landmark,
	type LucideIcon,
	PiggyBank,
	Wallet,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { Account } from "../domain/model.ts";
import "./AccountIcon.css";

const icons: Record<Account["kind"], LucideIcon> = {
	cash: Wallet,
	investment: Landmark,
	property: Home,
	debt: Building2,
};

export function AccountIcon({
	account,
}: {
	account: Pick<Account, "id" | "kind" | "color">;
}) {
	const Icon = account.id === "savings" ? PiggyBank : icons[account.kind];
	const style: CSSProperties | undefined = account.color
		? {
				backgroundColor: `color-mix(in srgb, ${account.color} 22%, var(--surface))`,
				borderColor: `color-mix(in srgb, ${account.color} 42%, var(--line))`,
				color: account.color,
			}
		: undefined;
	return (
		<span className={`account-icon account-${account.kind}`} style={style}>
			<Icon size={19} strokeWidth={1.7} aria-hidden="true" />
		</span>
	);
}

export function AccountDot({ color }: { color: Account["color"] }) {
	return (
		<i
			className="account-dot"
			style={color ? { backgroundColor: color } : undefined}
			aria-hidden="true"
		/>
	);
}
