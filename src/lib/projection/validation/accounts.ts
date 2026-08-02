import type { Account } from "../types/model";
import type { ModelValidationIssue } from "../types/validation";
import { addIssue } from "../utils/validation";
import type { ValidationPaths } from "./types";

export function validateAccountIdentity(
	issues: ModelValidationIssue[],
	accounts: Account[],
	postingIds: Set<string>,
	paths: ValidationPaths,
) {
	accounts.forEach((account, index) => {
		if (postingIds.has(account.id)) {
			addIssue(
				issues,
				"error",
				"account.id.collision",
				`Account ID '${account.id}' collides with a posting ID. IDs must be unique across accounts and postings.`,
				paths.account(index, "id"),
			);
		}
		if (account.enabled && account.color === null) {
			addIssue(
				issues,
				"warning",
				"account.color.missing",
				`Enabled account '${account.id}' has no chart color. Charts will use a neutral fallback until a color is provided.`,
				paths.account(index, "color"),
			);
		}
	});
}

export function validateAccountBounds(
	issues: ModelValidationIssue[],
	accounts: Account[],
	paths: ValidationPaths,
) {
	accounts.forEach((account, index) => {
		if (account.minBalance > account.maxBalance) {
			addIssue(
				issues,
				"error",
				"account.balance.bounds",
				`minBalance (${account.minBalance}) must not exceed maxBalance (${account.maxBalance}).`,
				paths.account(index),
			);
		}
	});
}
