import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { InputField } from "../../components/Field.tsx";
import { connectSyncKey } from "../../state/syncSettings.ts";

export function SyncConnectForm({
	readOnly,
	onCancel,
	onConnected,
}: {
	readOnly: boolean;
	onCancel: () => void;
	onConnected: () => void;
}) {
	const [token, setToken] = useState("");
	const [accessUrl, setAccessUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleConnect(input: {
		setupToken?: string;
		accessUrl?: string;
	}) {
		setBusy(true);
		setError(null);
		const ok = await connectSyncKey(input);
		setBusy(false);
		if (ok) {
			onConnected();
		} else {
			setError("Could not connect. Check the token and try again.");
		}
	}

	return (
		<div className="mt-3">
			{error && <ErrorNotice message={error} />}
			<InputField
				label="Setup token"
				type="text"
				autoComplete="off"
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				value={token}
				disabled={readOnly || busy}
				onChange={(event) => setToken(event.currentTarget.value)}
				placeholder="Paste your setup token"
			/>
			<div className="mt-3 flex flex-wrap gap-3">
				<Button
					type="button"
					disabled={
						readOnly || busy || token.trim() === "" || accessUrl.trim() !== ""
					}
					onClick={() => void handleConnect({ setupToken: token.trim() })}
				>
					{busy ? "Connecting…" : "Connect bank"}
				</Button>
				<Button type="button" variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
			</div>
			<details className="mt-4 text-sm">
				<summary className="cursor-pointer text-muted">
					Already have an access URL?
				</summary>
				<div className="mt-3">
					<InputField
						label="Access URL"
						type="password"
						autoComplete="off"
						value={accessUrl}
						disabled={readOnly || busy}
						onChange={(event) => setAccessUrl(event.currentTarget.value)}
						placeholder="https://user:pass@host/simplefin"
					/>
					<div className="mt-3">
						<Button
							type="button"
							variant="secondary"
							disabled={
								readOnly ||
								busy ||
								accessUrl.trim() === "" ||
								token.trim() !== ""
							}
							onClick={() =>
								void handleConnect({ accessUrl: accessUrl.trim() })
							}
						>
							{busy ? "Connecting…" : "Connect with URL"}
						</Button>
					</div>
				</div>
			</details>
		</div>
	);
}
