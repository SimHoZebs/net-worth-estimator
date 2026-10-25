import { useEffect, useState } from "react";

/** Single holder for a selected id. Clears when `resetKey` changes (e.g. a
 * new plan arrives) so stale ids never render a silent `null`. Dialog
 * presence stays owned by the dialog components themselves (Modal/Drawer
 * self-register with the modal stack); the holder never registers. */
export function useSelectedId(
	resetKey: unknown,
): [string | null, (id: string | null) => void] {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Clearing a stale selection when the plan changes is the intended sync,
	// not a render cascade.
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect
		setSelectedId(null);
	}, [resetKey]);
	return [selectedId, setSelectedId];
}

/** Single holder for a selected entry object. Same reset rule, no presence. */
export function useSelectedEntry<T>(
	resetKey: unknown,
): [T | null, (entry: T | null) => void] {
	const [selected, setSelected] = useState<T | null>(null);
	// Clearing a stale selection when the plan changes is the intended sync,
	// not a render cascade.
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect
		setSelected(null);
	}, [resetKey]);
	return [selected, setSelected];
}
