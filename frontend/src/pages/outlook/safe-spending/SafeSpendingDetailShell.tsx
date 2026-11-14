import { useId } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet.tsx";
import {
	Tabs,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs.tsx";
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
	const id = useId();
	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent
				side="right"
				aria-label={title}
				className="overflow-y-auto max-sm:data-[side=right]:w-full max-sm:data-[side=right]:max-w-full sm:max-w-3xl"
			>
				<SheetHeader className="border-b-0 p-4 pb-2">
					{range && (
						<p className="mb-2 text-xs font-bold tracking-widest text-muted">
							{`${dateLabel(range.start, true)} – ${dateLabel(range.end, true)}`}
						</p>
					)}
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription className="sr-only">
						SafeSpending detail view
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 pb-4">
			<Tabs
				value={tab}
				onValueChange={(next) => onTabChange(next as SafeSpendingDetailTab)}
				className="gap-0"
			>
				<TabsList
					variant="line"
					aria-label="SafeSpending detail view"
					activateOnFocus
					className="mb-4 flex w-full gap-6 overflow-x-auto border-0 border-b border-solid border-line p-0 max-sm:gap-5"
				>
					{SAFE_SPENDING_DETAIL_TABS.map((item) => (
						<TabsTrigger
							key={item.id}
							id={`${id}-${item.id}`}
							value={item.id}
							className="flex h-auto flex-none items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm font-normal whitespace-nowrap text-muted after:hidden hover:text-ink aria-selected:font-semibold aria-selected:text-ink focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-primary focus-visible:ring-0"
						>
							{item.label}
							{counts[item.id] != null && (
								<span className="min-w-5 rounded-control bg-active px-1 py-px text-xs text-success-text">
									{counts[item.id]}
								</span>
							)}
						</TabsTrigger>
					))}
				</TabsList>
				<div
					id={`${id}-panel`}
					role="tabpanel"
					aria-labelledby={`${id}-${tab}`}
				>
					{children}
				</div>
				</Tabs>
				</div>
			</SheetContent>
		</Sheet>
	);
}
