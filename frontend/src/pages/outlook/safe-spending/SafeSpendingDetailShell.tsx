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
	const title =
		SAFE_SPENDING_DETAIL_TABS.find((item) => item.id === tab)?.label ??
		"This cycle";
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
				className="account-view-tabs safe-spending-detail-tabs"
			>
				{children}
			</Tabs>
		</Drawer>
	);
}
