import { Drawer } from "../../../components/Drawer.tsx";
import { Tabs } from "../../../components/Tabs.tsx";
import type { SafeSpendingDetailTab } from "./safeSpendingDetailModel.ts";

const TITLES: Record<SafeSpendingDetailTab, string> = {
	mandatory: "Bills",
	cycle: "Where the cycle went",
	configure: "Configure",
};

export function SafeSpendingDetailShell({
	tab,
	onTabChange,
	cycleCount,
	onClose,
	children,
}: {
	tab: SafeSpendingDetailTab;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
	cycleCount: number;
	onClose: () => void;
	children: React.ReactNode;
}) {
	const title = TITLES[tab];
	return (
		<Drawer
			side="right"
			open
			onClose={onClose}
			label={title}
			appearance={{ title, coverage: "full" }}
		>
			<Tabs
				items={[
					{ id: "mandatory", label: "Bills" },
					{
						id: "cycle",
						label: "Where the cycle went",
						count: cycleCount,
					},
					{ id: "configure", label: "Configure" },
				]}
				value={tab}
				onChange={onTabChange}
				label="SafeSpending detail view"
				className="account-view-tabs safe-spending-detail-tabs"
			>
				{children}
			</Tabs>
		</Drawer>
	);
}
