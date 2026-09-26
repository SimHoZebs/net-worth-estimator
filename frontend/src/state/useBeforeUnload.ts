import { useEffect } from "react";

export function useBeforeUnload(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [enabled]);
}
