import type { Account } from "../../domain/model.ts";
export function AccountOptions({ accounts }: { accounts: Account[] }) {
	return accounts.map((account) => (
		<option key={account.id} value={account.id}>
			{account.name}
		</option>
	));
}
