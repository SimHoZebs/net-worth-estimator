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
					<strong>Server access token ready.</strong> It stays in this tab’s
					memory and is cleared when this page closes.
				</span>
				<button type="button" className="text-button" onClick={onClear}>
					Clear token
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
				<strong>Server authentication required.</strong> Enter the bearer token
				to enable protected saves. It stays in React memory only and is never
				stored or added to the URL.
			</span>
			<form className="auth-form" onSubmit={submit}>
				<label className="sr-only" htmlFor="waypoint-server-token">
					Server bearer token
				</label>
				<input
					id="waypoint-server-token"
					type="password"
					value={token}
					onChange={(event) => setToken(event.target.value)}
					autoComplete="off"
					spellCheck={false}
					required
				/>
				<button type="submit" className="button primary small">
					Use token
				</button>
			</form>
		</div>
	);
}
