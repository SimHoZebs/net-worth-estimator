import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	changeAccountPassword,
	getAccountProfile,
	listAccountSessions,
	revokeAccountSession,
	updateAccountProfile,
} from "../api/generated/endpoints.ts";
import type {
	AccountProfileUpdate,
	AccountPasswordChange,
} from "../api/generated/model/index.ts";
import { ApiHttpError } from "../api/http.ts";
import { getApiBaseUrl } from "../api/runtime.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import {
	canonicalApiBaseUrl,
	getAccountScope,
	subscribeAccountScope,
} from "./resourceScope.ts";
import type { Session } from "./sessionContext.ts";

async function accountRequest<T>(
	scope: ReturnType<typeof getAccountScope>,
	session: Session | null,
	perform: () => Promise<T>,
	fallback = "Account details are unavailable.",
): Promise<T> {
	if (scope !== getAccountScope() || !isAccountScope(scope, session))
		throw new Error("The active account changed.");
	try {
		const result = await perform();
		if (scope !== getAccountScope() || !isAccountScope(scope, session))
			throw new Error("The active account changed.");
		return result;
	} catch (cause) {
		if (cause instanceof ApiHttpError && cause.status === 401)
			throw new Error("Sign in to manage your account.");
		// A missing endpoint means the account service is not serving the
		// request. The raw transport body ("404 page not found") names a
		// route, not the account, so it never reaches the UI.
		if (cause instanceof ApiHttpError && cause.status === 404)
			throw new Error(fallback);
		if (cause instanceof ApiHttpError)
			throw new Error(cause.detail ?? fallback);
		throw cause;
	}
}

function isAccountScope(
	scope: ReturnType<typeof getAccountScope>,
	session: Session | null,
): boolean {
	return (
		scope.status === "ready" &&
		session?.authenticated === true &&
		scope.subject === session.user?.subject &&
		scope.resource != null &&
		scope.resource.id === session.resource.id &&
		scope.apiBaseUrl === canonicalApiBaseUrl(getApiBaseUrl())
	);
}

export function useAccountResources(session: Session | null) {
	const client = serverQueryClient();
	const baseUrl = getApiBaseUrl();
	const scope = useSyncExternalStore(subscribeAccountScope, getAccountScope);
	const key = ["account", scope.key] as const;
	const options = queryOptions({
		queryKey: key,
		enabled: isAccountScope(scope, session),
		queryFn: ({ signal }) =>
			accountRequest(scope, session, async () => {
				const [profile, sessions] = await Promise.all([
					getAccountProfile({ signal, baseUrl }),
					accountRequest(
						scope,
						session,
						() => listAccountSessions({ signal, baseUrl }),
						"The session list is unavailable.",
					),
				]);
				if (
					typeof profile.data.name !== "string" ||
					typeof profile.data.owner !== "string"
				)
					throw new Error("The account service returned an invalid profile.");
				if (!Array.isArray(sessions.data.sessions))
					throw new Error("The session list is invalid.");
				return { profile: profile.data, sessions: sessions.data.sessions };
			}),
	});
	const details = useQuery(options, client);
	const profile = useMutation(
		{
			gcTime: 0,
			retry: false,
			mutationKey: [...key, "profile"],
			mutationFn: (input: AccountProfileUpdate) =>
				accountRequest(
					scope,
					session,
					async () => (await updateAccountProfile(input, { baseUrl })).data,
					"The account update was rejected.",
				),
			onSuccess: (profile) => {
				if (scope !== getAccountScope()) return;
				client.setQueryData(key, (previous: typeof details.data) =>
					previous ? { ...previous, profile } : previous,
				);
			},
		},
		client,
	);
	const password = useMutation(
		{
			gcTime: 0,
			retry: false,
			mutationKey: [...key, "password"],
			mutationFn: (input: AccountPasswordChange) =>
				accountRequest(
					scope,
					session,
					() => changeAccountPassword(input, { baseUrl }),
					"The password change was rejected.",
				),
		},
		client,
	);
	const revoke = useMutation(
		{
			gcTime: 0,
			retry: false,
			mutationKey: [...key, "revoke"],
			mutationFn: (id: string) =>
				accountRequest(
					scope,
					session,
					() => revokeAccountSession({ id }, { baseUrl }),
					"That session could not be revoked.",
				),
		},
		client,
	);
	return {
		scopeKey: scope.key,
		details,
		profile,
		password,
		revoke,
		reload: () => details.refetch({ throwOnError: true }),
	};
}
