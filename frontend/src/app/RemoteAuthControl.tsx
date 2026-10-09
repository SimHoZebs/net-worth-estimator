import { LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";

export function RemoteAuthControl({
	tokenActive,
	required,
	onApply,
	onClear,
}: {
	tokenActive: boolean;
	required: boolean;
	onApply: (token: string) => void;
	onClear: () => void;
}) {
	if (tokenActive)
		return (
			<div className="inline-notice auth-notice">
				<LockKeyhole size={18} aria-hidden="true" />
				<span>
					<strong>Saving unlocked.</strong>
				</span>
				<button type="button" className="text-button" onClick={onClear}>
					Lock
				</button>
			</div>
		);
	return required ? <RemoteAuthPrompt onApply={onApply} /> : null;
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
