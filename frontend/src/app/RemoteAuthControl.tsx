import { LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useUiStore } from "../state/uiStore.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";

export function RemoteAuthControl() {
	// Token and auth state subscribe here; saving unlocks without prop
	// threading. Applying retries the workspace load, mirroring the previous
	// app-level effect on token changes.
	const tokenActive = useUiStore((state) => state.authToken) !== "";
	const required = useWorkspaceStore((state) => state.authRequiredState);
	const setAuthToken = useUiStore((state) => state.setAuthToken);
	const retry = useWorkspaceStore((state) => state.retry);
	if (tokenActive)
		return (
			<div className="inline-notice auth-notice">
				<LockKeyhole size={18} aria-hidden="true" />
				<span>
					<strong>Saving unlocked.</strong>
				</span>
				<button
					type="button"
					className="text-button"
					onClick={() => setAuthToken("")}
				>
					Lock
				</button>
			</div>
		);
	return required ? (
		<RemoteAuthPrompt
			onApply={(token) => {
				setAuthToken(token);
				void retry();
			}}
		/>
	) : null;
}

function RemoteAuthPrompt({ onApply }: { onApply: (token: string) => void }) {
	const [token, setToken] = useState("");
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const next = token.trim();
		if (next) onApply(next);
	};
	return (
		<div className="inline-notice auth-notice">
			<LockKeyhole size={18} aria-hidden="true" />
			<span>
				<strong>Saving is locked.</strong>
			</span>
			<form className="auth-form" onSubmit={submit}>
				<label className="sr-only" htmlFor="waypoint-server-token">
					Password
				</label>
				<input
					id="waypoint-server-token"
					type="password"
					value={token}
					onChange={(event) => setToken(event.target.value)}
					autoComplete="off"
					spellCheck={false}
					placeholder="Password"
					required
				/>
				<button type="submit" className="button primary small">
					Unlock
				</button>
			</form>
		</div>
	);
}
