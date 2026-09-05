import { z } from "zod";

export const workspaceActivitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("maintenance_request"),
    requestId: z.string().min(1),
    summary: z.string().min(1).max(240),
    urgent: z.boolean(),
  }),
  z.object({
    kind: z.literal("tenant_document"),
    documentId: z.string().min(1),
    title: z.string().min(1).max(160),
    action: z.enum(["uploaded", "reviewed"]),
  }),
  z.object({
    kind: z.literal("inspection_reminder"),
    inspectionId: z.string().min(1),
    propertyLabel: z.string().min(1).max(120),
    dueAt: z.string().datetime(),
  }),
]);

export type WorkspaceActivity = z.infer<typeof workspaceActivitySchema>;

export type ActivityDecision = {
  event: "workspace.activity";
  priority: "normal" | "attention";
  activity: WorkspaceActivity;
};

export function decideActivity(
  activity: WorkspaceActivity,
  now: Date,
): ActivityDecision {
  const overdueInspection =
    activity.kind === "inspection_reminder" &&
    Date.parse(activity.dueAt) < now.getTime();
  const urgentMaintenance =
    activity.kind === "maintenance_request" && activity.urgent;

  return {
    event: "workspace.activity",
    priority: overdueInspection || urgentMaintenance ? "attention" : "normal",
    activity,
  };
}
