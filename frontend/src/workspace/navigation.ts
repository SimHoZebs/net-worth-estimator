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
	subtitle: string;
};

export const pages: PageDefinition[] = [
	{
		id: "outlook",
		label: "Outlook",
		icon: LayoutDashboard,
		title: "Your financial outlook",
		subtitle: "A little clarity for the road ahead.",
	},
	{
		id: "plan",
		label: "Your plan",
		icon: Wallet,
		title: "The plan behind the picture",
		subtitle:
			"The accounts, movements, and assumptions that shape your future.",
	},
	{
		id: "goals",
		label: "Goals",
		icon: Flag,
		title: "Make the future meaningful",
		subtitle: "Know where you’re headed, and what it takes to get there.",
	},
	{
		id: "compare",
		label: "Compare",
		icon: GitCompareArrows,
		title: "Small changes. Clearer choices.",
		subtitle: "See the consequence before you commit.",
	},
	{
		id: "sources",
		label: "Data & sources",
		icon: HardDrive,
		title: "Confidence starts at the source",
		subtitle:
			"Know what’s recorded, what’s assumed, and what needs a closer look.",
	},
];

export const getPage = (): Page =>
	pages.find((page) => page.id === window.location.hash.slice(1))?.id ??
	"outlook";
