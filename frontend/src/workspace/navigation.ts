import {
	ArrowRightLeft,
	type Compass,
	Flag,
	Inbox,
	LayoutDashboard,
	Settings,
	ShoppingBag,
	Users,
	Wallet,
} from "lucide-react";

export type Page =
	| "outlook"
	| "accounts"
	| "transactions"
	| "purchases"
	| "evaluations"
	| "groups"
	| "inbox"
	| "sources";
export type PageDefinition = {
	id: Page;
	label: string;
	icon: typeof Compass;
	title: string;
};

export const pages: PageDefinition[] = [
	{
		id: "outlook",
		label: "Outlook",
		icon: LayoutDashboard,
		title: "Your financial outlook",
	},
	{
		id: "accounts",
		label: "Accounts",
		icon: Wallet,
		title: "Accounts and starting balances",
	},
	{
		id: "transactions",
		label: "Transactions",
		icon: ArrowRightLeft,
		title: "Planned transactions",
	},
	{
		id: "purchases",
		label: "Planned purchases",
		icon: ShoppingBag,
		title: "Planned purchases",
	},
	{
		id: "evaluations",
		label: "Evaluations",
		icon: Flag,
		title: "Check what your accounts support",
	},
	{
		id: "groups",
		label: "Groups",
		icon: Users,
		title: "Manage your groups",
	},
	{
		id: "inbox",
		label: "Inbox",
		icon: Inbox,
		title: "Transactions shared with you",
	},
	{
		id: "sources",
		label: "Configs",
		icon: Settings,
		title: "How your data is configured",
	},
];
