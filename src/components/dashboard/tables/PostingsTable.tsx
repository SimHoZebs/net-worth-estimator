import type {
	Account,
	FinancialModelDocument,
	Posting,
} from "@/lib/projection";
import { EditablePostingsGrid } from "./primitives/postings-edit";
import { ReadOnlyPostingsView } from "./primitives/postings-view";

export interface PostingsTableEditProps {
	displayDocument: FinancialModelDocument;
	document: FinancialModelDocument;
	isDirty: boolean;
	workingDocument: FinancialModelDocument | null;
	projectionStartDate: string;
	updatePosting: (id: string, changes: Partial<Posting>) => void;
	deletePosting: (id: string) => void;
	addPosting: (posting: Posting) => void;
}

export interface PostingsTableViewProps {
	postings: Posting[];
	accounts: Account[];
	projectionStartDate: string;
	showAdvanced: boolean;
}

export type PostingsTableProps =
	| ({ editable: true } & PostingsTableEditProps)
	| ({ editable?: false } & PostingsTableViewProps);

export function PostingsTable(props: PostingsTableProps) {
	if (props.editable === true) {
		const { editable, ...editProps } = props;
		return <EditablePostingsGrid {...editProps} />;
	}
	const { editable, ...viewProps } = props;
	return <ReadOnlyPostingsView {...viewProps} />;
}
