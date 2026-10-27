import { useState } from "react";
import { Landmark } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { useSyncCredential } from "../../state/syncSettings.ts";
import { SyncConnectModal } from "./SyncConnectModal.tsx";
import { SyncProviderModal } from "./SyncProviderModal.tsx";

export function SyncSettings({
	accounts,
	readOnly,
}: {
	accounts: { id: string; name: string }[];
	readOnly: boolean;
}) {
	const credential = useSyncCredential();
	const [chooserOpen, setChooserOpen] = useState(false);
	const [connectOpen, setConnectOpen] = useState(false);

	const connectedCount = credential.data?.configured === true ? 1 : 0;
	const status =
		connectedCount === 1 ? "1 provider connected" : "Not connected";

	return (
		<section
			aria-label="Bank sync"
			className="mb-6 rounded-surface border border-line bg-surface p-6 max-sm:p-5"
		>
			<div className="mb-2 flex items-center gap-4">
				<span className="text-primary-text">
					<Landmark size={25} />
				</span>
				<div className="flex-1">
					<h2 className="text-base max-sm:text-sm">Bank sync.</h2>
					<p className="m-0 text-sm text-muted">
						Connect a bank-data provider. Only connected providers sync.
					</p>
				</div>
			</div>

			{credential.isPending ? (
				<Skeleton className="h-10 w-full" />
			) : credential.isError ? (
				<ErrorNotice message="The sync connection could not be loaded." />
			) : (
				<div className="flex items-center gap-3">
					<Button type="button" onClick={() => setChooserOpen(true)}>
						Bank sync
					</Button>
					<span className="text-sm text-muted">{status}</span>
				</div>
			)}

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
		</section>
	);
}
