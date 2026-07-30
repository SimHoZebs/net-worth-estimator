import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		if (Object.is(value, debouncedValue)) return;
		const timeout = setTimeout(() => setDebouncedValue(value), delayMs);
		return () => clearTimeout(timeout);
	}, [debouncedValue, delayMs, value]);

	return debouncedValue;
}
