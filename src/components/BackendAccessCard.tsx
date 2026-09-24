import { useState } from "react";
import { Field, FieldInput } from "@/components/fields/FieldKit";
import { SectionCard } from "@/components/present/Present";
import { Button } from "@/components/ui/Button";
import { clearAuthToken, setAuthToken, useAuthToken } from "@/lib/authToken";

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
			title="Access"
			className="rounded-[1.4rem] border-border/80"
			contentClassName="space-y-3"
		>
			<div className="type-caption">
				{activeToken ? "Token set" : "No token"}
			</div>
			<Field label="Token" id="backend-access-token">
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
					Set
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
						Clear
					</Button>
				) : null}
			</div>
		</SectionCard>
	);
}
