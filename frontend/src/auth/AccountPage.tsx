import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { ErrorNotice } from "../components/ErrorNotice.tsx";
import { InputField } from "../components/Field.tsx";
import {
	dismissKey,
	notifyError,
	notifySuccess,
} from "../state/notifications.ts";
import { redirectToSignIn } from "./navigation.ts";
import { useSession } from "./sessionContext.ts";
import { useUserResources } from "./userApi.ts";

export function AccountPage() {
	const account = useSession();
	const session = account?.session ?? null;
	const logout = account?.logout ?? (async () => {});
	const logoutPending = account?.logoutPending ?? false;
	const resources = useUserResources(session);
	const profile = resources.details.data?.profile ?? null;
	const sessions = resources.details.data?.sessions ?? [];
	const [nameDraft, setNameDraft] = useState<{
		scopeKey: string;
		profile: typeof profile;
		value: string;
	} | null>(null);
	const displayName =
		nameDraft?.scopeKey === resources.scopeKey && nameDraft.profile === profile
			? nameDraft.value
			: (profile?.displayName ?? "");
	const [oldPassword, setOldPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const loading = resources.details.isPending;
	const detailsError =
		resources.details.isError && profile === null
			? (resources.details.error?.message ??
				"Account details could not be loaded.")
			: null;
	const savingProfile = resources.profile.isPending;
	const savingPassword =
		resources.password.isPending || resources.password.isSuccess;
	const saveBlocked = savingProfile || loading || profile === null;

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
		dismissKey("account");
		dismissKey("account-notice");
		try {
			await resources.profile.mutateAsync({
				displayName: displayName.trim(),
			});
			setNameDraft(null);
			notifySuccess("account-notice", "Display name updated.");
		} catch (cause) {
			notifyError(
				"account",
				cause instanceof Error
					? cause.message
					: "The account update was rejected.",
			);
		}
	}

	async function onChangePassword(event: React.FormEvent) {
		event.preventDefault();
		dismissKey("account");
		dismissKey("account-notice");
		try {
			await resources.password.mutateAsync({ oldPassword, newPassword });
			redirectToSignIn();
		} catch (cause) {
			notifyError(
				"account",
				cause instanceof Error
					? cause.message
					: "The password change was rejected.",
			);
		}
	}

	async function onRevoke(id: string) {
		dismissKey("account");
		dismissKey("account-notice");
		try {
			await resources.revoke.mutateAsync(id);
		} catch (cause) {
			notifyError(
				"account",
				cause instanceof Error
					? cause.message
					: "That session could not be revoked.",
			);
			return;
		}
		try {
			await resources.reload();
			notifySuccess("account-notice", "Session revoked.");
		} catch (cause) {
			notifySuccess("account-notice", "Session revoked.");
			notifyError(
				"account",
				cause instanceof Error
					? cause.message
					: "The session list could not be refreshed.",
			);
		}
	}

	return (
		<section aria-labelledby="account-heading" className="grid max-w-xl gap-8">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="account-heading" className="m-0">
						Account
					</h2>
					<p className="mb-0 text-sm text-muted">
						Signed in as {profile?.name ?? session.user?.name ?? "your account"}
						.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					disabled={logoutPending}
					onClick={() => {
						void logout();
					}}
				>
					<LogOut size={14} aria-hidden="true" />
					{logoutPending ? "Signing out…" : "Sign out"}
				</Button>
			</div>

			{detailsError && (
				<ErrorNotice
					message={detailsError}
					action="Retry"
					onAction={() => {
						void resources.details.refetch();
					}}
				/>
			)}

			<form onSubmit={onSaveProfile} className="grid gap-3">
				<h3 className="m-0 text-base">Profile</h3>
				<InputField
					label="Display name"
					value={displayName}
					maxLength={128}
					disabled={loading || profile === null}
					onChange={(event) =>
						setNameDraft({
							scopeKey: resources.scopeKey,
							profile,
							value: event.target.value,
						})
					}
					autoComplete="name"
				/>
				<div>
					<Button type="submit" variant="primary" disabled={saveBlocked}>
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
					Changing the password signs you out on every device.
				</p>
			</form>

			<div className="grid gap-3">
				<h3 className="m-0 text-base">Sessions</h3>
				{loading ? (
					<p className="m-0 text-sm text-muted">Loading sessions…</p>
				) : detailsError ? (
					<p className="m-0 text-sm text-muted">
						The session list is unavailable.
					</p>
				) : sessions.length === 0 ? (
					<p className="m-0 text-sm text-muted">No other signed-in devices.</p>
				) : (
					<ul className="grid list-none gap-2 p-0">
						{sessions.map((item) => (
							<li
								key={item.id}
								className="flex items-center justify-between gap-3 rounded-control border border-solid border-line px-3 py-2 text-sm"
							>
								<span className="text-muted">
									{item.current ? "This device" : "Another device"} · expires{" "}
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
				{session.accountURL ? (
					<a
						href={session.accountURL}
						className="text-xs font-medium text-primary underline underline-offset-4"
					>
						Manage passkeys on the provider page
					</a>
				) : (
					<p className="m-0 text-xs leading-relaxed text-muted">
						Passkey management is unavailable in this session.
					</p>
				)}
			</div>
		</section>
	);
}
