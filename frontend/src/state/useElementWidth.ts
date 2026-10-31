import { useEffect, useRef, useState } from "react";

/**
 * Measured content width of an element in CSS pixels. Observes resizes so
 * SVG charts can render their viewBox at native scale instead of stretching
 * a fixed mobile/desktop viewBox across every container.
 */
export function useElementWidth<T extends HTMLElement>() {
	const ref = useRef<T | null>(null);
	const [width, setWidth] = useState<number | null>(null);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		if (typeof ResizeObserver === "undefined") {
			setWidth(element.clientWidth);
			return;
		}
		const update = () => setWidth(element.clientWidth);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, width] as const;
}
