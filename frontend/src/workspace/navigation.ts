import {
	ArrowRightLeft,
	type Compass,
	Flag,
	LayoutDashboard,
	Settings,
	ShoppingBag,
	UserRound,
	Wallet,
} from "lucide-react";

export type Page =
	| "outlook"
	| "accounts"
	| "transactions"
	| "purchases"
	| "evaluations"
	| "sources"
	| "account";
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
		title: "Plan your purchases",
	},
	{
		id: "evaluations",
		label: "Evaluations",
		icon: Flag,
		title: "Check what the plan supports",
	},
	{
		id: "sources",
		label: "Configs",
		icon: Settings,
		title: "How the plan is configured",
	},
	{
		id: "account",
		label: "Account",
		icon: UserRound,
		title: "Account and sign-in",
	},
];

export const getPage = (): Page => {
	const hash = window.location.hash.slice(1);
	if (hash === "plan") return "accounts";
	if (hash === "goals") return "evaluations";
	return pages.find((page) => page.id === hash)?.id ?? "outlook";
};
