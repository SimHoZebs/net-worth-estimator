const questions = [
	{
		question: "My setup token did not work",
		answer:
			"Create a new app connection for Waypoint in SimpleFIN. Copy the full setup token and paste it here. If it still fails, check your network or try later.",
	},
	{
		question: "My bank or an account is missing",
		answer:
			"Open SimpleFIN and check that the bank connection is healthy and the account is shared with this app. Complete any bank verification there. Then return to Waypoint and use Sync now. If your bank is not supported, you can still maintain your accounts manually.",
	},
	{
		question: "How often does my data update?",
		answer:
			"The server checks SimpleFIN about every six hours when sync is enabled. Banks may provide new data less often, so a successful sync does not always mean a new balance. Manual syncs also have limits. If a sync is rate-limited, wait before you try again.",
	},
	{
		question: "Can I stop syncing later?",
		answer:
			"Yes. Disconnect SimpleFIN here to stop future imports. Your existing accounts and imported history stay in Waypoint. To revoke the app’s access at SimpleFIN too, disable its app connection in your SimpleFIN account.",
	},
] as const;

export function SyncHelp() {
	return (
		<div className="rounded-surface border border-line bg-surface p-5 sm:p-6">
			<h3 className="mt-0 mb-3 text-base">SimpleFIN help</h3>
			<div className="divide-y divide-line">
				{questions.map(({ question, answer }) => (
					<details key={question} className="py-3">
						<summary className="cursor-pointer text-sm font-semibold leading-relaxed">
							{question}
						</summary>
						<p className="mt-3 mb-0 text-sm leading-relaxed text-muted">
							{answer}
						</p>
					</details>
				))}
			</div>
		</div>
	);
}
