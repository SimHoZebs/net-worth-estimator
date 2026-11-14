import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { EditorSelect } from "./editorFields.tsx";
import { transactionBody } from "./transactionBodies.ts";

it("keeps an imported __none account distinct from the external choice and in the payload", async () => {
	const user = userEvent.setup();
	function AccountSelection() {
		const [fromId, setFromId] = useState("");
		const body = transactionBody({
			name: "Transfer",
			amount: 10,
			fromId: fromId || null,
			toId: "checking",
			startDate: "2026-11-14",
			postedDate: null,
			enabled: true,
			claimScheduleId: null,
			claimOccurrenceDate: null,
		});
		return (
			<>
				<EditorSelect
					value={fromId}
					onValueChange={setFromId}
					emptyLabel="External"
					options={[{ value: "__none", label: "Imported account" }]}
				/>
				<output>{JSON.stringify(body)}</output>
			</>
		);
	}
	render(<AccountSelection />);
	const trigger = screen.getByRole("combobox");
	const payload = () =>
		JSON.parse(screen.getByRole("status").textContent ?? "{}");
	expect(trigger.textContent).toContain("External");
	expect(payload()).not.toHaveProperty("sourceAccountId");
	await user.click(trigger);
	await user.click(screen.getByRole("option", { name: "Imported account" }));
	expect(trigger.textContent).toContain("Imported account");
	expect(payload().sourceAccountId).toBe("__none");
	await user.click(trigger);
	await user.keyboard("{Escape}");
	expect(payload().sourceAccountId).toBe("__none");
	await user.click(trigger);
	await user.click(screen.getByRole("option", { name: "External" }));
	expect(trigger.textContent).toContain("External");
	expect(payload()).not.toHaveProperty("sourceAccountId");
});
