import { NO_CEILING, NO_FLOOR } from "../constants";
import type { Account } from "../types/model";

export function makeAccount(
	overrides: Partial<Account> & { id: string },
): Account {
	return {
		label: overrides.id,
		minBalance: NO_FLOOR,
		maxBalance: NO_CEILING,
		color: null,
		enabled: true,
		...overrides,
	};
}
