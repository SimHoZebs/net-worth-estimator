import { ArrowLeft, Plus, Users } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { GroupSharingSection } from "./GroupSharingSection.tsx";
import {
	useCreateGroup,
	useCreateInvite,
	useDeleteGroup,
	useGroupDetail,
	useGroupInvites,
	useGroups,
	useJoinGroup,
	useLeaveGroup,
	useRemoveMember,
	useRevokeInvite,
	useUpdateMemberRole,
} from "../state/groups.ts";
import { useRouter } from "@tanstack/react-router";
import { useBreadcrumbSlot } from "../workspace/breadcrumbSlot.tsx";
import { notifyError, notifySuccess } from "../state/notifications.ts";
import { SharedFeed } from "./groups/SharedFeed.tsx";

function InlineError({
	message,
	action,
	onAction,
}: {
	message: string | null;
	action: string;
	onAction: () => void;
}) {
	if (!message) return null;
	return (
		<Alert variant="destructive">
			<AlertCircle size={16} aria-hidden="true" />
			<AlertDescription>
				{message}{" "}
				<Button variant="link" onClick={onAction}>
					{action}
				</Button>
			</AlertDescription>
		</Alert>
	);
}

export function GroupsPage({
	selectedGroupId,
}: {
	selectedGroupId: string | null;
}) {
	const router = useRouter();
	const breadcrumbSlot = useBreadcrumbSlot();
	const selected = selectedGroupId;
	const goToGroups = () => void router.navigate({ to: "/groups" });
	const openGroup = (id: string) =>
		void router.navigate({ to: "/groups/$groupId", params: { groupId: id } });
	const [showCreate, setShowCreate] = useState(false);
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [creating, setCreating] = useState(false);
	const [joining, setJoining] = useState(false);
	const inviteCodeId = useId();
	const groupNameId = useId();

	// Server state lives in TanStack Query, keyed by user scope and selected
	// group. A late response for group A resolves into A's cache entry and
	// never overwrites the selected group B; deselection disables the detail
	// queries so no stale detail remains visible.
	const groupsQuery = useGroups();
	const groups = groupsQuery.data ?? null;
	const detailQuery = useGroupDetail(selected);
	const detail = selected
		? (detailQuery.data?.group ??
			groups?.find((group) => group.id === selected) ??
			null)
		: null;
	const members = detailQuery.data?.members ?? [];
	const verifiedRole = detailQuery.data?.group.role ?? null;
	const canManageInvites = verifiedRole === "owner" || verifiedRole === "admin";
	const invitesQuery = useGroupInvites(selected, verifiedRole);
	// Cached invites stay hidden once the role no longer manages them.
	const invites = canManageInvites ? (invitesQuery.data ?? []) : [];
	const detailError = detailQuery.isError ? "Group could not be loaded." : null;

	const createGroupMutation = useCreateGroup();
	const joinGroupMutation = useJoinGroup();
	const leaveGroupMutation = useLeaveGroup();
	const deleteGroupMutation = useDeleteGroup();
	const updateMemberRoleMutation = useUpdateMemberRole();
	const removeMemberMutation = useRemoveMember();
	const createInviteMutation = useCreateInvite();
	const revokeInviteMutation = useRevokeInvite();

	async function onCreate(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		setCreating(true);
		try {
			const group = await createGroupMutation.mutateAsync(name.trim());
			setName("");
			setShowCreate(false);
			openGroup(group.id);
			notifySuccess("groups-notice", "Group created.");
		} catch {
			notifyError("groups", "Group could not be created.");
		} finally {
			setCreating(false);
		}
	}

	async function onJoin(event: React.FormEvent) {
		event.preventDefault();
		if (!code.trim()) return;
		setJoining(true);
		try {
			const group = await joinGroupMutation.mutateAsync(code.trim());
			setCode("");
			openGroup(group.id);
			notifySuccess("groups-notice", "Joined group.");
		} catch {
			notifyError("groups", "Invite could not be accepted.");
		} finally {
			setJoining(false);
		}
	}

	async function onLeave(id: string) {
		try {
			await leaveGroupMutation.mutateAsync(id);
			goToGroups();
			notifySuccess("groups-notice", "Left group.");
		} catch {
			notifyError("groups", "Could not leave group.");
		}
	}

	async function onDelete(id: string) {
		try {
			await deleteGroupMutation.mutateAsync(id);
			goToGroups();
			notifySuccess("groups-notice", "Group deleted.");
		} catch {
			notifyError("groups", "Could not delete group.");
		}
	}

	async function onPromote(groupId: string, accountId: string) {
		try {
			await updateMemberRoleMutation.mutateAsync({
				groupId,
				accountId,
				role: "admin",
			});
			notifySuccess("groups-notice", "Member is now an admin.");
		} catch {
			notifyError("groups", "Role could not be changed.");
		}
	}

	async function onRemove(groupId: string, accountId: string) {
		try {
			await removeMemberMutation.mutateAsync({ groupId, accountId });
			notifySuccess("groups-notice", "Member removed.");
		} catch {
			notifyError("groups", "Member could not be removed.");
		}
	}

	async function onRevoke(groupId: string, inviteId: string) {
		try {
			await revokeInviteMutation.mutateAsync({ groupId, inviteId });
			notifySuccess("groups-notice", "Invite revoked.");
		} catch {
			notifyError("groups", "Invite could not be revoked.");
		}
	}
	async function onInvite(groupId: string) {
		try {
			const { code: fresh } = await createInviteMutation.mutateAsync(groupId);
			try {
				await navigator.clipboard?.writeText(fresh);
			} catch {
				// Copy is best-effort; the invite already exists.
			}
			notifySuccess("groups-notice", "Invite code copied.");
		} catch {
			notifyError("groups", "Invite could not be created.");
		}
	}

	if (selected) {
		const groupName = detail?.name ?? "Group";
		const breadcrumb = (
			<nav aria-label="Breadcrumb">
				<ol className="m-0 flex min-w-0 list-none flex-nowrap items-center gap-2 p-0 text-xs">
					<li className="flex-none">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={goToGroups}
						>
							<ArrowLeft size={16} aria-hidden="true" />
							Groups
						</Button>
					</li>
					<li aria-hidden="true" className="flex-none text-muted-foreground">
						/
					</li>
					<li
						aria-current="page"
						title={groupName}
						className="min-w-0 max-w-[32ch] truncate font-medium"
					>
						{groupName}
					</li>
				</ol>
			</nav>
		);
		return (
			<section aria-label="Group details" className="grid gap-6">
				{breadcrumbSlot ? createPortal(breadcrumb, breadcrumbSlot) : null}
				{detailError ? (
					<InlineError
						message={detailError}
						action="Back to groups"
						onAction={() => goToGroups()}
					/>
				) : (
					<>
						<div>
							<h2 className="m-0 text-xl">{detail?.name ?? "Group"}</h2>
							{detail && (
								<p className="mb-0 text-sm text-muted-foreground">
									{detail.role} · {detail.memberCount} member
									{detail.memberCount === 1 ? "" : "s"}
								</p>
							)}
						</div>

						{detail && (detail.role === "owner" || detail.role === "admin") && (
							<div>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => void onInvite(detail.id)}
								>
									New invite code
								</Button>
							</div>
						)}

						<ul aria-label="Members" className="grid list-none gap-2 p-0">
							{members.map((member) => (
								<li
									key={member.accountId}
									className="flex items-center justify-between gap-3 rounded-md border border-solid border-border px-3 py-2 text-sm"
								>
									<span>
										{member.displayName || member.accountId}{" "}
										<span className="text-muted-foreground">
											· {member.role}
										</span>
									</span>
									<span className="flex gap-2">
										{detail &&
											detail.role === "owner" &&
											member.role !== "owner" && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														void onPromote(detail.id, member.accountId)
													}
												>
													Make admin
												</Button>
											)}
										{detail &&
											(detail.role === "owner" ||
												(detail.role === "admin" &&
													member.role === "member")) && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														void onRemove(detail.id, member.accountId)
													}
												>
													Remove
												</Button>
											)}
									</span>
								</li>
							))}
						</ul>

						{selected && (
							<SharedFeed
								groupId={selected}
								members={members.map((member) => ({
									accountId: member.accountId,
									displayName: member.displayName,
								}))}
							/>
						)}

						{canManageInvites && (
							<InlineError
								message={
									invitesQuery.isError ? "Invites could not be loaded." : null
								}
								action="Retry invites"
								onAction={() => void invitesQuery.refetch()}
							/>
						)}
						{invites.length > 0 && (
							<ul className="grid list-none gap-2 p-0">
								{invites.map((invite) => (
									<li
										key={invite.id}
										className="flex items-center justify-between gap-3 text-sm"
									>
										<span className="text-muted-foreground">
											Uses {invite.usedCount}/{invite.maxUses}
										</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => void onRevoke(selected, invite.id)}
										>
											Revoke
										</Button>
									</li>
								))}
							</ul>
						)}

						{detail && <GroupSharingSection groupId={detail.id} />}

						{detail && (
							<div className="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => void onLeave(detail.id)}
								>
									Leave group
								</Button>
								{detail.role === "owner" && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void onDelete(detail.id)}
									>
										Delete group
									</Button>
								)}
							</div>
						)}
					</>
				)}
			</section>
		);
	}

	return (
		<section aria-label="Groups" className="grid gap-6">
			<div className="flex items-center justify-end gap-4">
				<Button
					type="button"
					variant="default"
					onClick={() => setShowCreate(true)}
				>
					<Plus size={16} aria-hidden="true" />
					Create group
				</Button>
			</div>

			<InlineError
				message={groupsQuery.isError ? "Groups could not be loaded." : null}
				action="Retry"
				onAction={() => void groupsQuery.refetch()}
			/>

			<div className="grid gap-2">
				{groups === null ? (
					<p className="m-0 text-sm text-muted-foreground" role="status">
						Loading groups…
					</p>
				) : groups.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Users aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No groups yet</EmptyTitle>
							<EmptyDescription>
								Create a group to get started, or join one with an invite code.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button variant="default" onClick={() => setShowCreate(true)}>
								Create group
							</Button>
						</EmptyContent>
					</Empty>
				) : (
					<ul className="grid list-none gap-2 p-0">
						{groups.map((group) => (
							<li
								key={group.id}
								className="flex items-center justify-between gap-3 rounded-md border border-solid border-border px-3 py-2 text-sm"
							>
								<span>
									<strong>{group.name}</strong>{" "}
									<span className="text-muted-foreground">
										· {group.role} · {group.memberCount} member
										{group.memberCount === 1 ? "" : "s"}
									</span>
								</span>
								<span className="flex gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => openGroup(group.id)}
									>
										Open
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void onLeave(group.id)}
									>
										Leave
									</Button>
									{group.role === "owner" && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => void onDelete(group.id)}
										>
											Delete
										</Button>
									)}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>

			<form onSubmit={onJoin} className="grid max-w-md gap-2">
				<h2 className="m-0 text-base">Join with a code</h2>
				<Field>
					<Label htmlFor={inviteCodeId}>Invite code</Label>
					<Input
						id={inviteCodeId}
						value={code}
						onChange={(event) => setCode(event.target.value)}
					/>
				</Field>
				<div>
					<Button
						type="submit"
						variant="secondary"
						disabled={joining || !code.trim()}
					>
						{joining ? "Joining…" : "Join group"}
					</Button>
				</div>
			</form>

			{showCreate && (
				<Dialog
					open
					onOpenChange={(open) => {
						if (!open) setShowCreate(false);
					}}
				>
					<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>Create group</DialogTitle>
						</DialogHeader>
						<form onSubmit={onCreate} className="grid gap-4">
							<Field>
								<Label htmlFor={groupNameId}>Group name</Label>
								<Input
									id={groupNameId}
									value={name}
									maxLength={100}
									onChange={(event) => setName(event.target.value)}
								/>
							</Field>
							<DialogFooter>
								<Button
									type="button"
									variant="secondary"
									onClick={() => setShowCreate(false)}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									variant="default"
									disabled={creating || !name.trim()}
								>
									{creating ? "Creating…" : "Create group"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			)}
		</section>
	);
}
