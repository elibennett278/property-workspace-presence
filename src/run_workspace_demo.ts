const baseUrl = `http://localhost:${process.env.PORT ?? 3000}`;

async function post(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}

const session = await post("/session", {
  workspaceId: "harbor-court",
  memberId: "manager-17",
});
console.log("Client session:", session);

const activity = await post("/activity", {
  workspaceId: "harbor-court",
  activity: {
    kind: "inspection_reminder",
    inspectionId: "inspection-204",
    propertyLabel: "Harbor Court, Building B",
    dueAt: "2026-09-01T09:00:00.000Z",
  },
});
console.log("Published activity:", activity);

const onlineResponse = await fetch(`${baseUrl}/workspaces/harbor-court/online`, {
  method: "GET",
});
const online = await onlineResponse.json();
if (!onlineResponse.ok) throw new Error(JSON.stringify(online));
console.log("Online workspace members:", online);
