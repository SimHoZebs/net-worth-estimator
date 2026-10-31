import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Match Tailwind's stock max-sm and max-md variants, including their boundaries. */
export const viewportQueries = {
	belowSm: "(width < 40rem)",
	belowMd: "(width < 48rem)",
} as const;

export function useMediaQuery(
	query: string,
	onChange?: (matches: boolean) => void,
) {
	const media = useMemo(() => window.matchMedia(query), [query]);
	const subscribe = useCallback(
		(notify: () => void) => {
			const update = () => {
				onChange?.(media.matches);
				notify();
			};
			media.addEventListener("change", update);
			return () => media.removeEventListener("change", update);
		},
		[media, onChange],
	);
	return useSyncExternalStore(
		subscribe,
		() => media.matches,
		() => false,
	);
}
