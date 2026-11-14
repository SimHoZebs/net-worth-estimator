import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useId, useState, type Ref } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { connectSyncKey } from "../../state/syncSettings.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";

export function SyncConnectForm({
	onConnected,
	inputRef,
}: {
	onConnected: () => void;
	inputRef: Ref<HTMLInputElement>;
}) {
	const readOnly = useUserReadOnly();
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
			setError("Connection failed.");
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
			<Field>
				<Label htmlFor={inputId}>Setup token</Label>
				<Input
					id={inputId}
					ref={inputRef}
					name="setupToken"
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
			</Field>
			<div className="mt-2 flex justify-end">
				<Button
					variant="link"
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
				</Button>
			</div>
			{error ? (
				<p id={errorId} role="alert">
					{error}
				</p>
			) : null}
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<Button type="submit" variant="default" disabled={readOnly || busy}>
					{busy ? "Connecting…" : "Connect SimpleFIN"}
					{!busy && <ArrowRight size={16} aria-hidden="true" />}
				</Button>
			</div>
			<p className="mt-3 mb-0 min-h-[2lh] text-xs leading-relaxed text-muted">
				{busy
					? "Keep this page open while Waypoint connects to SimpleFIN."
					: null}
			</p>
		</form>
	);
}
