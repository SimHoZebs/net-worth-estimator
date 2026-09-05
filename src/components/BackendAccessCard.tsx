import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clearAuthToken, setAuthToken, useAuthToken } from "@/lib/auth-token";

/**
 * Backend write access. The token is stored only in this browser and sent
 * solely as an Authorization header on save. Reads and projections never
 * carry it. It is never logged.
 */
export function BackendAccessCard() {
	const activeToken = useAuthToken();
	const [draft, setDraft] = useState("");

	const saveToken = () => {
		if (draft.trim() === "") return;
		setAuthToken(draft);
		setDraft("");
	};

	return (
		<Card className="rounded-[1.4rem] border-border/80">
			<CardHeader>
				<CardTitle>Backend access</CardTitle>
				<CardDescription>
					Write access to the canonical model. Required for Save when the server
					guards writes; leave empty for read-only use.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="type-caption">
					Status:{" "}
					<strong>{activeToken ? "Token set" : "No token (read-only)"}</strong>
				</div>
				<label className="block">
					<span className="type-label">Access token</span>
					<Input
						type="password"
						aria-label="Access token"
						autoComplete="off"
						placeholder={activeToken ? "••••••••" : "Paste token"}
						className="mt-1"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") saveToken();
						}}
					/>
				</label>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						onClick={saveToken}
						disabled={draft.trim() === ""}
					>
						Set token
					</Button>
					{activeToken ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								clearAuthToken();
								setDraft("");
							}}
						>
							Clear token
						</Button>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
