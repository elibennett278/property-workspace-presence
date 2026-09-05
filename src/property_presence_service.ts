import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InfraiError, InfraiRealtime } from "./infrai_realtime.js";
import { decideActivity, workspaceActivitySchema } from "./workspace_activity.js";

const workspaceSchema = z.string().regex(/^[a-z0-9-]{2,64}$/);
const tokenBodySchema = z.object({
  workspaceId: workspaceSchema,
  memberId: z.string().min(1).max(80),
});
const activityBodySchema = z.object({
  workspaceId: workspaceSchema,
  activity: workspaceActivitySchema,
});

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const realtime = new InfraiRealtime(apiKey);

function channelFor(workspaceId: string) {
  return `property-workspace-${workspaceId}`;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function clientStatus(error: InfraiError) {
  return error.status >= 400 && error.status < 500 ? error.status : 502;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/session") {
      const body = tokenBodySchema.parse(await readJson(request));
      const channel = channelFor(body.workspaceId);
      await realtime.createChannel(channel, `channel-${body.workspaceId}`);
      const token = await realtime.issueToken(body.memberId, channel);
      return json(response, 200, { channel, token });
    }

    if (request.method === "POST" && request.url === "/activity") {
      const body = activityBodySchema.parse(await readJson(request));
      const decision = decideActivity(body.activity, new Date());
      const eventId = randomUUID();
      await realtime.publish(
        channelFor(body.workspaceId),
        decision.event,
        decision,
        eventId,
      );
      return json(response, 202, { eventId, priority: decision.priority });
    }

    const match = request.url?.match(/^\/workspaces\/([a-z0-9-]+)\/online$/);
    if (request.method === "GET" && match) {
      const workspaceId = workspaceSchema.parse(match[1]);
      const presence = await realtime.presence(channelFor(workspaceId));
      return json(response, 200, { workspaceId, presence });
    }

    return json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(response, 400, { error: "Invalid request", issues: error.issues });
    }
    if (error instanceof InfraiError) {
      return json(response, clientStatus(error), {
        error: error.message,
        code: error.code,
      });
    }
    console.error(error);
    return json(response, 500, { error: "Request could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Property presence service on http://localhost:${port}`));
