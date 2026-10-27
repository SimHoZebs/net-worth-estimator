import { useState } from "react";
import { Landmark } from "lucide-react";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import type { Account } from "../../domain/model.ts";
import { useSyncCredential } from "../../state/syncSettings.ts";
import { SyncConnectModal } from "./SyncConnectModal.tsx";
import { SyncProviderModal } from "./SyncProviderModal.tsx";

type SyncAccount = Pick<Account, "id" | "kind" | "color" | "name">;

export function SyncSettings({
	accounts,
	readOnly,
}: {
	accounts: SyncAccount[];
	readOnly: boolean;
}) {
	const credential = useSyncCredential();
	const [chooserOpen, setChooserOpen] = useState(false);
	const [connectOpen, setConnectOpen] = useState(false);

	const connectedCount = credential.data?.configured === true ? 1 : 0;
	const status =
		connectedCount === 1 ? "1 provider connected" : "Not connected";

	if (credential.isPending || credential.isError) {
		return (
			<section
				aria-label="Bank sync"
				className="mb-6 rounded-surface border border-line bg-surface p-6 max-sm:p-5"
			>
				<div className="flex items-center gap-4">
					<span className="text-primary-text">
						<Landmark size={25} />
					</span>
					<div className="flex-1">
						<h2 className="text-base max-sm:text-sm">Bank sync.</h2>
					</div>
				</div>

				{credential.isPending ? (
					<Skeleton className="mt-3 h-10 w-full" />
				) : (
					<ErrorNotice message="The sync connection could not be loaded." />
				)}
			</section>
		);
	}

	return (
		<>
			<button
				type="button"
				aria-label="Bank sync"
				aria-describedby="bank-sync-status"
				onClick={() => setChooserOpen(true)}
				className="mb-6 flex w-full cursor-pointer items-center gap-4 rounded-surface border border-line bg-surface p-6 text-left transition-colors hover:border-line-strong max-sm:p-5"
			>
				<span className="text-primary-text">
					<Landmark size={25} />
				</span>
				<span className="flex-1 text-base max-sm:text-sm">Bank sync.</span>
				<span id="bank-sync-status" className="text-sm text-muted">
					{status}
				</span>
			</button>

			{chooserOpen && (
				<SyncProviderModal
					accounts={accounts}
					readOnly={readOnly}
					onClose={() => setChooserOpen(false)}
					onConnect={() => setConnectOpen(true)}
				/>
			)}
			{connectOpen && (
				<SyncConnectModal
					readOnly={readOnly}
					onClose={() => setConnectOpen(false)}
					onConnected={() => setConnectOpen(false)}
				/>
			)}
		</>
	);
}
