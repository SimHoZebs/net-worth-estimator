import { createFileRoute } from "@tanstack/react-router";
import { GroupsPage } from "../../pages/GroupsPage.tsx";

export const Route = createFileRoute("/groups/$groupId")({
	component: GroupsDetailRoute,
});

function GroupsDetailRoute() {
	const { groupId } = Route.useParams();
	return <GroupsPage selectedGroupId={groupId} />;
}
