import { Drawer } from "../../../components/Drawer.tsx";
import { Tabs } from "../../../components/Tabs.tsx";
import { dateLabel } from "../../../domain/format.ts";
import {
	SAFE_SPENDING_DETAIL_TABS,
	type SafeSpendingDetailTab,
	type SafeSpendingCycleTab,
} from "./safeSpendingDetailModel.ts";

export function SafeSpendingDetailShell({
	tab,
	onTabChange,
	cycleCounts,
	range,
	onClose,
	children,
}: {
	tab: SafeSpendingDetailTab;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
	cycleCounts: Partial<Record<SafeSpendingCycleTab, number>>;
	range?: { start: string; end: string };
	onClose: () => void;
	children: React.ReactNode;
}) {
	const title = "Safe card spending";
	const counts: Partial<Record<SafeSpendingDetailTab, number>> = cycleCounts;
	return (
		<Drawer
			side="right"
			open
			onClose={onClose}
			label={title}
			appearance={{
				title,
				eyebrow: range
					? `${dateLabel(range.start, true)} – ${dateLabel(range.end, true)}`
					: undefined,
				coverage: "full",
				headerClassName: "border-b-0 pb-2",
				bodyClassName: "pt-0",
			}}
		>
			<Tabs
				items={SAFE_SPENDING_DETAIL_TABS.map((item) => ({
					...item,
					count: counts[item.id],
				}))}
				value={tab}
				onChange={onTabChange}
				label="SafeSpending detail view"
				className="mb-4"
			>
				{children}
			</Tabs>
		</Drawer>
	);
}
