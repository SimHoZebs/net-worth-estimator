import { Info } from "lucide-react";
import { Modal } from "../ui.tsx";

const steps = [
	{
		title: "Start with what you know",
		description:
			"Recorded balances and clearly marked estimates establish today’s position.",
	},
	{
		title: "Follow the plan forward",
		description:
			"Dated income, spending, transfers and account rates produce a base case. Optional ranges vary investment returns across 400 scenarios.",
	},
	{
		title: "Try a change, then decide",
		description:
			"Edit a temporary version, compare the outcome, and explicitly save or discard. Drafts stay in this browser between visits.",
	},
];
export function MethodEvidence({ onClose }: { onClose: () => void }) {
	return (
		<Modal
			title="A considered view of your future"
			eyebrow="How Waypoint works"
			onClose={onClose}
		>
			<div className="method-steps">
				{steps.map((step, index) => (
					<div key={step.title}>
						<span>0{index + 1}</span>
						<div>
							<h3>{step.title}</h3>
							<p>{step.description}</p>
						</div>
					</div>
				))}
			</div>
			<div className="inline-notice">
				<Info size={18} />
				<span>
					"The saved financial model is loaded from the Waypoint server.
					Temporary edits stay in this browser until you explicitly save them.
					Projections are planning aids and do not provide investment, tax or
					legal advice."
				</span>
			</div>
		</Modal>
	);
}
