import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { getApiBaseUrl } from "../api/runtime.ts";
import { Brand } from "../components/Brand.tsx";
import { Button } from "../components/Button.tsx";
import { serverQueryClient } from "../state/serverQuery.ts";
import { redirectToSignIn } from "./navigation.ts";

interface Session {
	enabled: boolean;
	provider?: string;
	authenticated?: boolean;
	allowed?: boolean;
	accountURL?: string;
	user?: { subject: string; name: string; role: string };
}

export function AuthBoundary({ children }: { children: ReactNode }) {
	const [logoutError, setLogoutError] = useState("");
	const query = useQuery(
		{
			queryKey: ["auth-session", getApiBaseUrl()],
			staleTime: 0,
			gcTime: 0,
			queryFn: async () => {
				const response = await fetch(`${getApiBaseUrl()}/v1/auth/session`, {
					credentials: "same-origin",
					cache: "no-store",
				});
				if (!response.ok)
					throw new Error("Authentication status is unavailable.");
				const next = (await response.json()) as Session;
				if (typeof next.enabled !== "boolean")
					throw new Error("Invalid authentication status.");
				if (
					next.enabled &&
					getApiBaseUrl() &&
					new URL(getApiBaseUrl(), location.href).origin !== location.origin
				) {
					throw new Error(
						"Session login requires the frontend and API on the same origin.",
					);
				}
				return next;
			},
		},
		serverQueryClient(),
	);
	const refresh = query.refetch;
	const session = query.error ? null : query.data;
	const error = logoutError || query.error?.message || "";
	useEffect(() => {
		if (session?.enabled && session.authenticated === false) {
			redirectToSignIn();
		}
	}, [session]);
	useEffect(() => {
		const check = () => {
			void refresh();
		};
		window.addEventListener("focus", check);
		window.addEventListener("waypoint:authentication-required", check);
		return () => {
			window.removeEventListener("focus", check);
			window.removeEventListener("waypoint:authentication-required", check);
		};
	}, [refresh]);
	const logout = async () => {
		try {
			const response = await fetch(`${getApiBaseUrl()}/v1/auth/logout`, {
				method: "POST",
				credentials: "same-origin",
			});
			if (!response.ok) throw new Error("Sign-out failed. Please retry.");
			const result = (await response.json()) as { logoutURL: string };
			// The server supplies a configured OIDC logout URL, never a user redirect.
			window.location.assign(result.logoutURL);
		} catch (cause) {
			setLogoutError(
				cause instanceof Error ? cause.message : "Sign-out failed.",
			);
		}
	};
	if (session && !session.enabled) return children;
	if (session?.authenticated && session.allowed)
		return (
			<>
				<div className="flex flex-wrap items-center justify-end gap-3 border-b border-line bg-surface px-6 py-2 text-sm">
					<span>
						{session.user?.name || session.user?.subject} ·{" "}
						{session.user?.role === "editor" ? "Editor" : "Read only"}
					</span>
					{session.accountURL && (
						<a href={session.accountURL}>Manage sign-in methods</a>
					)}
					<Button
						size="sm"
						onClick={() => {
							void logout();
						}}
					>
						Sign out
					</Button>
					{error && <span role="alert">{error}</span>}
				</div>
				{children}
			</>
		);
	return (
		<main className="mx-auto my-[12vh] max-w-156 px-6">
			<Brand />
			<h1 className="mt-11 mb-4">
				{session?.authenticated
					? "Access has not been granted"
					: "Your plan. Your access."}
			</h1>
			<p className="mb-6 text-muted">
				{session?.authenticated
					? "Your identity is verified. The server owner must grant this identity access to the plan."
					: session
						? "Redirecting to Casdoor for sign-in or account creation…"
						: "Checking your session…"}
			</p>
			{session?.authenticated && (
				<p className="mb-6 break-all font-mono text-sm">
					OIDC subject: {session.user?.subject}
				</p>
			)}
			{error && (
				<p role="alert" className="mb-4 text-danger-text">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-3">
				{session && !session.authenticated && (
					<Button variant="primary" onClick={redirectToSignIn}>
						Continue to sign in
					</Button>
				)}
				{session?.authenticated && (
					<Button
						onClick={() => {
							void logout();
						}}
					>
						Sign out
					</Button>
				)}
				{(error || session?.authenticated) && (
					<Button
						onClick={() => {
							void refresh();
						}}
					>
						Retry access check
					</Button>
				)}
			</div>
		</main>
	);
}
