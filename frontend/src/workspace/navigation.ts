import {
	type Compass,
	Flag,
	GitCompareArrows,
	HardDrive,
	LayoutDashboard,
	Wallet,
} from "lucide-react";

export type Page = "outlook" | "plan" | "goals" | "compare" | "sources";
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
		id: "plan",
		label: "Your plan",
		icon: Wallet,
		title: "The plan behind the picture",
	},
	{
		id: "goals",
		label: "Goals",
		icon: Flag,
		title: "Make the future meaningful",
	},
	{
		id: "compare",
		label: "Compare",
		icon: GitCompareArrows,
		title: "Small changes. Clearer choices.",
	},
	{
		id: "sources",
		label: "Data & sources",
		icon: HardDrive,
		title: "Confidence starts at the source",
	},
];

export const getPage = (): Page =>
	pages.find((page) => page.id === window.location.hash.slice(1))?.id ??
	"outlook";
