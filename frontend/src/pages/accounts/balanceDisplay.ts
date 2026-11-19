/**
 * Display-layer data contract. A single figure to render and the recorded
 * sync date. It carries no account concepts so the presentational component
 * only ever reflects what the translation layer decided to hand it.
 */
export interface BalanceDisplayEntry {
	label: string;
	value: number;
	emphasized: boolean;
}

export interface BalanceDisplayData {
	entries: BalanceDisplayEntry[];
	synced: string | null;
}
