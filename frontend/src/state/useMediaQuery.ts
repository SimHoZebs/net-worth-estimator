import { useEffect, useState } from "react";

/** Match Tailwind's stock max-sm and max-md variants, including their boundaries. */
export const viewportQueries = {
	belowSm: "(width < 40rem)",
	belowMd: "(width < 48rem)",
} as const;

export function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(
		() => window.matchMedia(query).matches,
	);
	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, [query]);
	return matches;
}
