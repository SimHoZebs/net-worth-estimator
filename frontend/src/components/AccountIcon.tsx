import {
	Building2,
	Home,
	Landmark,
	type LucideIcon,
	PiggyBank,
	Wallet,
} from "lucide-react";
import type { Account } from "../domain/model.ts";

const icons: Record<Account["kind"], LucideIcon> = {
	cash: Wallet,
	investment: Landmark,
	property: Home,
	debt: Building2,
};
export function AccountIcon({
	account,
}: {
	account: Pick<Account, "id" | "kind">;
}) {
	const Icon = account.id === "savings" ? PiggyBank : icons[account.kind];
	return (
		<span className={`account-icon account-${account.kind}`}>
			<Icon size={19} strokeWidth={1.7} aria-hidden="true" />
		</span>
	);
}
