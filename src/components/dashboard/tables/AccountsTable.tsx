import type {
	Account,
	FinancialModelDocument,
	Posting,
	ProjectionAccountSummary,
} from "@/lib/projection";
import { EditableAccountsGrid } from "./primitives/accounts-edit";
import { ReadOnlyAccountsView } from "./primitives/accounts-view";

export interface AccountsTableEditProps {
	displayDocument: FinancialModelDocument;
	document: FinancialModelDocument;
	isDirty: boolean;
	workingDocument: FinancialModelDocument | null;
	updateAccount: (id: string, changes: Partial<Account>) => void;
	deleteAccount: (id: string) => void;
	addAccount: (account: Account) => void;
}

export interface AccountsTableViewProps {
	accounts: Account[];
	accountRules: Posting[];
	accountSummaries: ProjectionAccountSummary[] | null;
	currentNetWorth: number | null;
	projectionStartDate: string;
	balancesAreStale: boolean;
	showAdvanced: boolean;
}

export type AccountsTableProps =
	| ({ editable: true } & AccountsTableEditProps)
	| ({ editable?: false } & AccountsTableViewProps);

export function AccountsTable(props: AccountsTableProps) {
	if (props.editable === true) {
		const { editable, ...editProps } = props;
		return <EditableAccountsGrid {...editProps} />;
	}
	const { editable, ...viewProps } = props;
	return <ReadOnlyAccountsView {...viewProps} />;
}
