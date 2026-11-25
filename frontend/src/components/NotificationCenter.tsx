import { Toaster } from "@/components/ui/toast.tsx";

/**
 * Single Base UI toast viewport, mounted once in the workspace layout. The
 * toast manager behind state/notifications.ts owns delivery: stable keys
 * upsert in place, non-action toasts auto-dismiss, manual dismissal or
 * recovery closes action errors, and identity-scope changes clear. The zero
 * provider timeout lets that policy keep retry actions persistent.
 */
export function NotificationCenter() {
	return <Toaster limit={4} timeout={0} />;
}
