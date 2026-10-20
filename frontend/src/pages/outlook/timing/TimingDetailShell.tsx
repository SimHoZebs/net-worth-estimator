import { Drawer } from "../../../components/Drawer.tsx";
import { Tabs } from "../../../components/Tabs.tsx";
import type { TimingDetailTab } from "./timingDetailModel.ts";

const TITLES: Record<TimingDetailTab, string> = {
	mandatory: "Bills",
	cycle: "Where the cycle went",
	configure: "Configure",
};

export function TimingDetailShell({
	tab,
	onTabChange,
	cycleCount,
	onClose,
	children,
}: {
	tab: TimingDetailTab;
	onTabChange: (tab: TimingDetailTab) => void;
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
			title={title}
			coverage="full"
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
				label="Timing detail view"
				className="account-view-tabs timing-detail-tabs"
			>
				{children}
			</Tabs>
		</Drawer>
	);
}
