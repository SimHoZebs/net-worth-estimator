import {
	createContext,
	useContext,
	useState,
	type ReactNode,
	type RefCallback,
} from "react";

/**
 * Slot for breadcrumb trails rendered by detail pages. The topbar owns
 * the DOM slot so breadcrumbs appear in the top navigation bar while
 * pages keep their own close guards.
 */
export const BreadcrumbSlotContext = createContext<{
	slot: HTMLDivElement | null;
	setSlot: RefCallback<HTMLDivElement>;
} | null>(null);

export function BreadcrumbSlotProvider({ children }: { children: ReactNode }) {
	const [slot, setSlot] = useState<HTMLDivElement | null>(null);
	return (
		<BreadcrumbSlotContext.Provider value={{ slot, setSlot }}>
			{children}
		</BreadcrumbSlotContext.Provider>
	);
}

export function useBreadcrumbSlot(): HTMLDivElement | null {
	return useContext(BreadcrumbSlotContext)?.slot ?? null;
}

export function useBreadcrumbSlotSetter(): RefCallback<HTMLDivElement> {
	return useContext(BreadcrumbSlotContext)?.setSlot ?? (() => {});
}
