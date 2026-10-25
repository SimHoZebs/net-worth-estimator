import { useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import { InputField } from "../components/Field.tsx";
import {
	useErrorToast,
	useSuccessToast,
} from "../components/NotificationCenter.tsx";
import { redirectToSignIn } from "./navigation.ts";
import { useSession } from "./sessionContext.ts";
import {
	changeAccountPassword,
	getAccountProfile,
	listAccountSessions,
	revokeAccountSession,
	updateAccountProfile,
	type AccountProfile,
	type AccountSessionItem,
} from "./accountApi.ts";

export function AccountPage() {
	const account = useSession();
	const session = account?.session ?? null;
	const [profile, setProfile] = useState<AccountProfile | null>(null);
	const [sessions, setSessions] = useState<AccountSessionItem[]>([]);
	const [displayName, setDisplayName] = useState("");
	const [oldPassword, setOldPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [notice, setNotice] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [reloadKey, setReloadKey] = useState(0);
	const [savingProfile, setSavingProfile] = useState(false);
	const [savingPassword, setSavingPassword] = useState(false);

	useEffect(() => {
		if (!session?.authenticated) {
			// oxlint-disable-next-line react/set-state-in-effect -- Syncs one-time account fetch state when auth resolves.
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		(async () => {
			try {
				const [nextProfile, nextSessions] = await Promise.all([
					getAccountProfile(controller.signal),
					listAccountSessions(controller.signal),
				]);
				if (controller.signal.aborted) return;
				setProfile(nextProfile);
				setDisplayName(nextProfile.displayName);
				setSessions(nextSessions);
			} catch (cause) {
				if (!controller.signal.aborted) {
					setError(
						cause instanceof Error
							? cause.message
							: "Account details are unavailable.",
					);
				}
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();
		return () => controller.abort();
	}, [session?.authenticated, reloadKey]);

	useErrorToast("account", error || null);
	useSuccessToast("account-notice", notice || null, () => setNotice(""));

	if (!session?.allowed) return null;
	if (!session.authenticated) {
		return (
			<section aria-labelledby="account-heading">
				<h2 id="account-heading">Account</h2>
				<p className="text-sm text-muted">Sign in to manage your account.</p>
				<Button variant="primary" onClick={redirectToSignIn}>
					Sign in
				</Button>
			</section>
		);
	}

	async function onSaveProfile(event: React.FormEvent) {
		event.preventDefault();
		setSavingProfile(true);
		setError("");
		setNotice("");
		try {
			const next = await updateAccountProfile({
				displayName: displayName.trim(),
			});
			setProfile(next);
			setDisplayName(next.displayName);
			setNotice("Display name updated.");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The account update was rejected.",
			);
		} finally {
			setSavingProfile(false);
		}
	}

	async function onChangePassword(event: React.FormEvent) {
		event.preventDefault();
		setSavingPassword(true);
		setError("");
		setNotice("");
		try {
			await changeAccountPassword({ oldPassword, newPassword });
			redirectToSignIn();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The password change was rejected.",
			);
			setSavingPassword(false);
		}
	}

	async function onRevoke(id: string) {
		setError("");
		setNotice("");
		try {
			await revokeAccountSession(id);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "That session could not be revoked.",
			);
			return;
		}
		try {
			setSessions(await listAccountSessions());
			setNotice("Session revoked.");
		} catch (cause) {
			setNotice("Session revoked.");
			setError(
				cause instanceof Error
					? cause.message
					: "The session list could not be refreshed.",
			);
		}
	}

	return (
		<section aria-labelledby="account-heading" className="grid max-w-xl gap-8">
			<div>
				<h2 id="account-heading">Account</h2>
				<p className="text-sm text-muted">
					Signed in as {profile?.name ?? session.user?.name ?? "your account"}.
				</p>
			</div>

			{loading ? (
				<p className="text-sm text-muted">Loading account details…</p>
			) : profile === null ? (
				<div className="grid gap-3">
					<p className="m-0 text-sm text-muted">
						Account details could not be loaded.
					</p>
					<div>
						<Button
							onClick={() => {
								setError("");
								setLoading(true);
								setReloadKey((key) => key + 1);
							}}
						>
							Retry
						</Button>
					</div>
				</div>
			) : (
				<>
					<form onSubmit={onSaveProfile} className="grid gap-3">
						<h3 className="m-0 text-base">Profile</h3>
						<InputField
							label="Display name"
							value={displayName}
							maxLength={128}
							onChange={(event) => setDisplayName(event.target.value)}
							autoComplete="name"
						/>
						<div>
							<Button type="submit" variant="primary" disabled={savingProfile}>
								{savingProfile ? "Saving…" : "Save display name"}
							</Button>
						</div>
					</form>

					<form onSubmit={onChangePassword} className="grid gap-3">
						<h3 className="m-0 text-base">Password</h3>
						<InputField
							label="Current password"
							type="password"
							value={oldPassword}
							onChange={(event) => setOldPassword(event.target.value)}
							autoComplete="current-password"
						/>
						<InputField
							label="New password"
							type="password"
							value={newPassword}
							onChange={(event) => setNewPassword(event.target.value)}
							autoComplete="new-password"
						/>
						<div>
							<Button type="submit" disabled={savingPassword}>
								{savingPassword ? "Changing…" : "Change password"}
							</Button>
						</div>
						<p className="m-0 text-xs text-muted">
							Password rules stay in the identity service. Changing the password
							signs you out on every device.
						</p>
					</form>

					<div className="grid gap-3">
						<h3 className="m-0 text-base">Sessions</h3>
						{sessions.length === 0 ? (
							<p className="m-0 text-sm text-muted">
								No other signed-in devices.
							</p>
						) : (
							<ul className="grid list-none gap-2 p-0">
								{sessions.map((item) => (
									<li
										key={item.id}
										className="flex items-center justify-between gap-3 rounded-control border border-solid border-line px-3 py-2 text-sm"
									>
										<span className="text-muted">
											{item.current ? "This device" : "Another device"} ·
											expires{" "}
											<time dateTime={item.expiresAt}>
												{new Date(item.expiresAt).toLocaleString()}
											</time>
										</span>
										{item.current ? null : (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => void onRevoke(item.id)}
											>
												Revoke
											</Button>
										)}
									</li>
								))}
							</ul>
						)}
					</div>

					<div className="grid gap-2">
						<h3 className="m-0 text-base">Passkeys</h3>
						<p className="m-0 text-xs leading-relaxed text-muted">
							Passkeys stay bound to the identity hostname, so enrollment and
							removal happen on the provider page.
							{session.accountURL
								? " Use the link below, then return here."
								: " Provider passkey management is unavailable in this session."}
						</p>
						{session.accountURL && (
							<a
								href={session.accountURL}
								className="text-xs font-medium text-primary underline underline-offset-4"
							>
								Manage passkeys on the provider page
							</a>
						)}
					</div>
				</>
			)}
		</section>
	);
}
