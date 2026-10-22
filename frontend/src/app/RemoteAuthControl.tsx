import { LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button, TextButton } from "../components/Button.tsx";
import { Input } from "../components/Field.tsx";
import { Notice } from "../components/Notice.tsx";
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
			<Notice className="flex-wrap items-center">
				<LockKeyhole size={18} aria-hidden="true" />
				<span className="min-w-56 flex-1">
					<strong>Saving unlocked.</strong>
				</span>
				<TextButton onClick={() => setAuthToken("")}>Lock</TextButton>
			</Notice>
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
		<Notice className="flex-wrap items-center">
			<LockKeyhole size={18} aria-hidden="true" />
			<span className="min-w-56 flex-1">
				<strong>Saving is locked.</strong>
			</span>
			<form
				className="ml-auto flex items-center gap-2 [@media(max-width:600px)]:ml-7 [@media(max-width:600px)]:w-full"
				onSubmit={submit}
			>
				<label className="sr-only" htmlFor="waypoint-server-token">
					Password
				</label>
				<Input
					id="waypoint-server-token"
					className="min-h-9 w-48 [@media(max-width:600px)]:w-auto [@media(max-width:600px)]:min-w-0 [@media(max-width:600px)]:flex-1"
					type="password"
					value={token}
					onChange={(event) => setToken(event.target.value)}
					autoComplete="off"
					spellCheck={false}
					placeholder="Password"
					required
				/>
				<Button type="submit" variant="primary" size="sm">
					Unlock
				</Button>
			</form>
		</Notice>
	);
}
