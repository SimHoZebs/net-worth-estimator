import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useId, useState, type Ref } from "react";
import { Button, TextButton } from "../../components/Button.tsx";
import { InputField } from "../../components/Field.tsx";
import { connectSyncKey } from "../../state/syncSettings.ts";

export function SyncConnectForm({
	readOnly,
	onConnected,
	inputRef,
}: {
	readOnly: boolean;
	onConnected: () => void;
	inputRef: Ref<HTMLInputElement>;
}) {
	const [token, setToken] = useState("");
	const [visible, setVisible] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputId = useId();
	const errorId = useId();

	async function handleConnect() {
		if (readOnly || busy) return;
		if (!token.trim()) {
			setError("Paste your setup token to connect.");
			return;
		}
		setBusy(true);
		setError(null);
		const ok = await connectSyncKey({ setupToken: token.trim() });
		setBusy(false);
		if (ok) {
			setToken("");
			onConnected();
		} else {
			setError(
				"Could not connect. Copy the entire setup token from SimpleFIN and try again. If the problem continues, create a new app connection in SimpleFIN.",
			);
		}
	}

	return (
		<form
			method="post"
			aria-label="Connect SimpleFIN"
			aria-busy={busy}
			onSubmit={(event) => {
				event.preventDefault();
				void handleConnect();
			}}
		>
			<InputField
				id={inputId}
				ref={inputRef}
				name="setupToken"
				label="Setup token"
				type={visible ? "text" : "password"}
				required
				autoComplete="off"
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				enterKeyHint="go"
				value={token}
				disabled={readOnly || busy}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				onChange={(event) => {
					setToken(event.currentTarget.value);
					setError(null);
				}}
				placeholder="Paste your setup token"
			/>
			<div className="mt-2 flex justify-end">
				<TextButton
					className="min-h-6"
					aria-controls={inputId}
					aria-pressed={visible}
					disabled={busy || readOnly}
					onClick={() => setVisible(!visible)}
				>
					{visible ? (
						<EyeOff size={14} aria-hidden="true" />
					) : (
						<Eye size={14} aria-hidden="true" />
					)}
					{visible ? "Hide token" : "Show token"}
				</TextButton>
			</div>
			{error && (
				<p
					id={errorId}
					role="alert"
					className="mt-2 mb-3 text-sm leading-relaxed text-danger-text"
				>
					{error}
				</p>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<Button type="submit" variant="primary" disabled={readOnly || busy}>
					{busy ? "Connecting…" : "Connect SimpleFIN"}
					{!busy && <ArrowRight size={16} aria-hidden="true" />}
				</Button>
			</div>
			{busy && (
				<p className="mt-3 mb-0 text-xs leading-relaxed text-muted">
					Keep this page open while Waypoint connects to SimpleFIN.
				</p>
			)}
		</form>
	);
}
