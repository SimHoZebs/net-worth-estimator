import {
	DraftCommitInput as KitDraftCommitInput,
	type DraftCommitInputProps as KitDraftCommitInputProps,
	editableTableCellInputStyle as kitEditableTableCellInputStyle,
} from "@/components/fields/field-kit";

// Backward-compatible re-export: tables import from here. The canonical
// implementation lives in the field kit.
export const DraftCommitInput = KitDraftCommitInput;
export const editableTableCellInputStyle = kitEditableTableCellInputStyle;
export type DraftCommitInputProps = KitDraftCommitInputProps;
