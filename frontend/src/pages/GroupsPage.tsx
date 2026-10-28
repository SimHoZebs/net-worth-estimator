import { ArrowLeft, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorNotice } from "../components/ErrorNotice.tsx";
import { InputField } from "../components/Field.tsx";
import { Modal } from "../components/Modal.tsx";
import { dialogActionsStyles } from "../components/dialogStyles.ts";
import { notifyError, notifySuccess } from "../state/notifications.ts";
import { groupHash, pageHash } from "../workspace/route.ts";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import {
	acceptInvite,
	createGroup,
	createInvite,
	deleteGroup,
	getGroup,
	leaveGroup,
	listGroups,
	listInvites,
	removeMember,
	revokeInvite,
	updateMemberRole,
	type GroupInvite,
	type GroupMember,
	type UserGroup,
} from "./groupsApi.ts";

export function GroupsPage() {
	const { route, pushHash } = useWorkspaceNavigation();
	const selected =
		route.page === "groups" && route.overlay?.type === "group"
			? route.overlay.key
			: null;
	const [groups, setGroups] = useState<UserGroup[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [members, setMembers] = useState<GroupMember[]>([]);
	const [invites, setInvites] = useState<GroupInvite[]>([]);
	const [detailGroup, setDetailGroup] = useState<UserGroup | null>(null);
	const [creating, setCreating] = useState(false);
	const [joining, setJoining] = useState(false);

	const reload = useCallback(async () => {
		try {
			setError(null);
			setGroups(await listGroups());
		} catch {
			setError("Groups could not be loaded.");
		}
	}, []);

	// Initial load from the API is external sync, not a render cascade.
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect
		void reload();
	}, [reload]);

	useEffect(() => {
		if (!selected) {
			// Clearing detail state when navigation leaves a group is the
			// intended sync, not a render cascade.
			// oxlint-disable-next-line react/set-state-in-effect
			setMembers([]);
			setInvites([]);
			setDetailError(null);
			setDetailGroup(null);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				setDetailError(null);
				const detail = await getGroup(selected);
				if (cancelled) return;
				setDetailGroup(detail.group);
				setMembers(detail.members);
				const role = detail.group.role;
				if (role === "owner" || role === "admin") {
					setInvites(await listInvites(selected));
				} else {
					setInvites([]);
				}
			} catch {
				if (!cancelled) {
					setDetailError("Group could not be loaded.");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selected]);

	async function onCreate(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		setCreating(true);
		try {
			const group = await createGroup(name.trim());
			setName("");
			setGroups((current) => (current ? [...current, group] : [group]));
			setShowCreate(false);
			pushHash(groupHash(group.id));
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
			const group = await acceptInvite(code.trim());
			setCode("");
			await reload();
			pushHash(groupHash(group.id));
			notifySuccess("groups-notice", "Joined group.");
		} catch {
			notifyError("groups", "Invite could not be accepted.");
		} finally {
			setJoining(false);
		}
	}

	async function onLeave(id: string) {
		try {
			await leaveGroup(id);
			pushHash(pageHash("groups"));
			await reload();
			notifySuccess("groups-notice", "Left group.");
		} catch {
			notifyError("groups", "Could not leave group.");
		}
	}

	async function onDelete(id: string) {
		try {
			await deleteGroup(id);
			pushHash(pageHash("groups"));
			await reload();
			notifySuccess("groups-notice", "Group deleted.");
		} catch {
			notifyError("groups", "Could not delete group.");
		}
	}

	async function onPromote(groupId: string, accountId: string) {
		try {
			await updateMemberRole(groupId, accountId, "admin");
			setMembers((await getGroup(groupId)).members);
			notifySuccess("groups-notice", "Member is now an admin.");
		} catch {
			notifyError("groups", "Role could not be changed.");
		}
	}

	async function onRemove(groupId: string, accountId: string) {
		try {
			await removeMember(groupId, accountId);
			const next = await getGroup(groupId);
			setMembers(next.members);
			void reload();
			notifySuccess("groups-notice", "Member removed.");
		} catch {
			notifyError("groups", "Member could not be removed.");
		}
	}

	async function onRevoke(groupId: string, inviteId: string) {
		try {
			await revokeInvite(groupId, inviteId);
			setInvites(await listInvites(groupId));
			notifySuccess("groups-notice", "Invite revoked.");
		} catch {
			notifyError("groups", "Invite could not be revoked.");
		}
	}
	async function onInvite(groupId: string) {
		try {
			const { code: fresh } = await createInvite(groupId);
			setInvites(await listInvites(groupId));
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

	const detail = selected
		? (detailGroup ?? groups?.find((group) => group.id === selected) ?? null)
		: null;

	if (selected) {
		return (
			<section aria-label="Group details" className="grid gap-6">
				<div>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => pushHash(pageHash("groups"))}
					>
						<ArrowLeft size={16} aria-hidden="true" />
						All groups
					</Button>
				</div>

				{detailError ? (
					<ErrorNotice
						message={detailError}
						action="Back to groups"
						onAction={() => pushHash(pageHash("groups"))}
					/>
				) : (
					<>
						<div>
							<h2 className="m-0 text-xl">{detail?.name ?? "Group"}</h2>
							{detail && (
								<p className="mb-0 text-sm text-muted">
									{detail.role} · {detail.memberCount} member
									{detail.memberCount === 1 ? "" : "s"}
								</p>
							)}
						</div>

						{detail && (detail.role === "owner" || detail.role === "admin") && (
							<div>
								<Button size="sm" onClick={() => void onInvite(detail.id)}>
									New invite code
								</Button>
							</div>
						)}

						<ul className="grid list-none gap-2 p-0">
							{members.map((member) => (
								<li
									key={member.accountId}
									className="flex items-center justify-between gap-3 rounded-control border border-solid border-line px-3 py-2 text-sm"
								>
									<span>
										{member.displayName || member.accountId}{" "}
										<span className="text-muted">· {member.role}</span>
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

						{invites.length > 0 && (
							<ul className="grid list-none gap-2 p-0">
								{invites.map((invite) => (
									<li
										key={invite.id}
										className="flex items-center justify-between gap-3 text-sm"
									>
										<span className="text-muted">
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
					variant="primary"
					onClick={() => setShowCreate(true)}
				>
					<Plus size={16} />
					Create group
				</Button>
			</div>

			{error && (
				<ErrorNotice
					message={error}
					action="Retry"
					onAction={() => void reload()}
				/>
			)}

			<div className="grid gap-2">
				{groups === null ? (
					<p className="m-0 text-sm text-muted" role="status">
						Loading groups…
					</p>
				) : groups.length === 0 ? (
					<EmptyState
						icon={Users}
						title="No groups yet"
						description="Create a group to get started, or join one with an invite code."
						action="Create group"
						onAction={() => setShowCreate(true)}
					/>
				) : (
					<ul className="grid list-none gap-2 p-0">
						{groups.map((group) => (
							<li
								key={group.id}
								className="flex items-center justify-between gap-3 rounded-control border border-solid border-line px-3 py-2 text-sm"
							>
								<span>
									<strong>{group.name}</strong>{" "}
									<span className="text-muted">
										· {group.role} · {group.memberCount} member
										{group.memberCount === 1 ? "" : "s"}
									</span>
								</span>
								<span className="flex gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => pushHash(groupHash(group.id))}
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
				<InputField
					label="Invite code"
					value={code}
					onChange={(event) => setCode(event.target.value)}
				/>
				<div>
					<Button type="submit" disabled={joining || !code.trim()}>
						{joining ? "Joining…" : "Join group"}
					</Button>
				</div>
			</form>

			{showCreate && (
				<Modal title="Create group" onClose={() => setShowCreate(false)}>
					<form onSubmit={onCreate} className="grid gap-4">
						<InputField
							label="Group name"
							value={name}
							maxLength={100}
							onChange={(event) => setName(event.target.value)}
						/>
						<div className={dialogActionsStyles}>
							<Button
								type="button"
								variant="secondary"
								onClick={() => setShowCreate(false)}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="primary"
								disabled={creating || !name.trim()}
							>
								{creating ? "Creating…" : "Create group"}
							</Button>
						</div>
					</form>
				</Modal>
			)}
		</section>
	);
}
