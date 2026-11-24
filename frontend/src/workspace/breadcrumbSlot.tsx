import {
	createContext,
	useContext,
	useState,
	type ReactNode,
	type RefCallback,
} from "react";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";

/**
 * Slot for breadcrumb trails rendered by detail pages. The active mobile
 * topbar or desktop content row owns the DOM slot so pages keep their own
 * close guards without rendering duplicate trails.
 */
export const BreadcrumbSlotContext = createContext<{
	slot: HTMLDivElement | null;
	setSlot: RefCallback<HTMLDivElement>;
	belowMd: boolean;
} | null>(null);

export function BreadcrumbSlotProvider({ children }: { children: ReactNode }) {
	const [slot, setSlot] = useState<HTMLDivElement | null>(null);
	const belowMd = useMediaQuery(viewportQueries.belowMd);
	return (
		<BreadcrumbSlotContext.Provider value={{ slot, setSlot, belowMd }}>
			{children}
		</BreadcrumbSlotContext.Provider>
	);
}

export function useBreadcrumbSlot(): HTMLDivElement | null {
	return useContext(BreadcrumbSlotContext)?.slot ?? null;
}

/** Attach the shared slot only in the requested viewport layout. */
export function useBreadcrumbSlotTarget(
	viewport: "belowMd" | "atLeastMd",
): RefCallback<HTMLDivElement> | null {
	const context = useContext(BreadcrumbSlotContext);
	if (!context) return null;
	return (viewport === "belowMd") === context.belowMd ? context.setSlot : null;
}
