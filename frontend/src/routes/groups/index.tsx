import { createFileRoute } from "@tanstack/react-router";
import { GroupsPage } from "../../pages/GroupsPage.tsx";

export const Route = createFileRoute("/groups/")({
	component: () => <GroupsPage selectedGroupId={null} />,
});
