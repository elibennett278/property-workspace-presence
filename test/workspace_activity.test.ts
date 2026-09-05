import assert from "node:assert/strict";
import test from "node:test";
import { decideActivity, workspaceActivitySchema } from "../src/workspace_activity.js";

test("an overdue inspection asks the workspace for attention", () => {
  const activity = workspaceActivitySchema.parse({
    kind: "inspection_reminder",
    inspectionId: "inspection-204",
    propertyLabel: "Harbor Court, Building B",
    dueAt: "2026-09-01T09:00:00.000Z",
  });

  const decision = decideActivity(activity, new Date("2026-09-03T10:00:00.000Z"));

  assert.equal(decision.priority, "attention");
  assert.equal(decision.event, "workspace.activity");
});
