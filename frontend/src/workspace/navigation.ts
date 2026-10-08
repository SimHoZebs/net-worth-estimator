import {
	ArrowRightLeft,
	type Compass,
	Flag,
	GitCompareArrows,
	LayoutDashboard,
	Settings,
	Wallet,
} from "lucide-react";

export type Page =
	| "outlook"
	| "accounts"
	| "transactions"
	| "evaluations"
	| "compare"
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
		id: "evaluations",
		label: "Evaluations",
		icon: Flag,
		title: "Check what the plan supports",
	},
	{
		id: "compare",
		label: "Compare",
		icon: GitCompareArrows,
		title: "Small changes. Clearer choices.",
	},
	{
		id: "sources",
		label: "Configs",
		icon: Settings,
		title: "How the plan is configured",
	},
];

export const getPage = (): Page => {
	const hash = window.location.hash.slice(1);
	if (hash === "plan") return "accounts";
	if (hash === "goals") return "evaluations";
	return pages.find((page) => page.id === hash)?.id ?? "outlook";
};
