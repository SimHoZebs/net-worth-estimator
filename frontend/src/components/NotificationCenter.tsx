import { Toaster } from "@/components/ui/toast.tsx";

/**
 * Single Base UI toast viewport, mounted once in the workspace layout. The
 * toast manager behind state/notifications.ts owns delivery: stable keys
 * upsert in place, manual dismissal or recovery closes, and identity-scope
 * changes clear. A zero timeout keeps errors and confirmations available
 * until then, including their retry actions.
 */
export function NotificationCenter() {
	return <Toaster limit={4} timeout={0} />;
}
