import { ArrowRight, ExternalLink, KeyRound } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { TextButton } from "../../components/Button.tsx";
import { buttonStyles } from "../../components/buttonStyles.ts";
import { mergeStyles } from "../../components/mergeStyles.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { SyncConnectForm } from "./SyncConnectForm.tsx";
import { simplefinLinks } from "./simplefinLinks.ts";

function SetupStep({
	number,
	title,
	children,
}: {
	number: number;
	title: string;
	children: ReactNode;
}) {
	return (
		<li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 sm:gap-4">
			<span
				aria-hidden="true"
				className="inline-grid size-8 place-items-center rounded-full border border-line-strong bg-surface text-sm font-semibold text-primary"
			>
				{number}
			</span>
			<div className="min-w-0 pb-2">
				<h3 className="mt-1 mb-2 text-base">{title}</h3>
				{children}
			</div>
		</li>
	);
}

export function SyncOnboarding({ onConnected }: { onConnected: () => void }) {
	const readOnly = useUserReadOnly();
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<div className="rounded-surface border border-line bg-surface p-5 sm:p-6">
			<div className="mb-4 flex justify-end">
				<TextButton
					className="min-h-6 text-sm"
					disabled={readOnly}
					onClick={() => inputRef.current?.focus()}
				>
					I already have a token <ArrowRight size={14} aria-hidden="true" />
				</TextButton>
			</div>
			<ol
				// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
				role="list"
				className="m-0 grid list-none gap-6 p-0"
				aria-label="SimpleFIN setup steps"
			>
				<SetupStep number={1} title="Link your banks in SimpleFIN">
					<p className="mt-0 mb-3 text-sm leading-relaxed text-muted">
						Create a SimpleFIN Bridge account or sign in. In My account, choose{" "}
						<strong>New connection</strong> and follow the prompts for each
						bank.
					</p>
					<p className="mt-0 mb-3 text-sm leading-relaxed text-muted">
						SimpleFIN requires a separate paid subscription. Check its pricing
						and bank support before you subscribe.
					</p>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
						<a
							href={simplefinLinks.home}
							target="_blank"
							rel="noopener noreferrer"
							className={mergeStyles(
								buttonStyles({ variant: "secondary" }),
								"hover:bg-hover",
							)}
						>
							Open SimpleFIN <ExternalLink size={14} aria-hidden="true" />
							<span className="sr-only"> (opens in a new tab)</span>
						</a>
						<a
							href={simplefinLinks.institutions}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex min-h-6 items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4"
						>
							Check bank support <ExternalLink size={14} aria-hidden="true" />
							<span className="sr-only"> (opens in a new tab)</span>
						</a>
					</div>
				</SetupStep>
				<SetupStep number={2} title="Create a setup token for Waypoint">
					<p className="mt-0 mb-3 text-sm leading-relaxed text-muted">
						In SimpleFIN, choose <strong>New app connection</strong>. Name it{" "}
						<strong>Waypoint</strong>, then choose{" "}
						<strong>Create Setup Token</strong>. Copy the entire token and
						return to this tab.
					</p>
					<a
						href={simplefinLinks.createToken}
						target="_blank"
						rel="noopener noreferrer"
						className={mergeStyles(
							buttonStyles({ variant: "secondary" }),
							"hover:bg-hover",
						)}
					>
						<KeyRound size={16} aria-hidden="true" /> Create a setup token{" "}
						<ExternalLink size={14} aria-hidden="true" />
						<span className="sr-only"> (opens in a new tab)</span>
					</a>
				</SetupStep>
				<SetupStep number={3} title="Connect to Waypoint">
					<p className="mt-0 mb-4 text-sm leading-relaxed text-muted">
						Paste the token you copied from SimpleFIN.
					</p>
					<SyncConnectForm onConnected={onConnected} inputRef={inputRef} />
				</SetupStep>
			</ol>
		</div>
	);
}
