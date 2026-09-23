import { useState } from "react";
import { Field, FieldInput } from "@/components/fields/field-kit";
import { SectionCard } from "@/components/present/present";
import { Button } from "@/components/ui/button";
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
		<SectionCard
			title="Backend access"
			description="Write access to the canonical model. Required for Save when the server guards writes; leave empty for read-only use."
			className="rounded-[1.4rem] border-border/80"
			contentClassName="space-y-3"
		>
			<div className="type-caption">
				Status:{" "}
				<strong>{activeToken ? "Token set" : "No token (read-only)"}</strong>
			</div>
			<Field label="Access token" id="backend-access-token">
				<FieldInput
					id="backend-access-token"
					type="password"
					autoComplete="off"
					placeholder={activeToken ? "••••••••" : "Paste token"}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") saveToken();
					}}
					className="min-h-11"
				/>
			</Field>
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
		</SectionCard>
	);
}
