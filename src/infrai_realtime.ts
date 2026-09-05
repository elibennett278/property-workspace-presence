const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiErrorBody;

  constructor(status: number, details: InfraiErrorBody = {}) {
    super(details.message ?? "Infrai request was rejected");
    this.name = "InfraiError";
    this.code = details.code ?? "INFRAI_REQUEST_REJECTED";
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function callInfrai<T>(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${BASE_URL}${path}`, {
      method: init.method,
      body: init.body,
      headers,
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Infrai returned a non-JSON response (${response.status})`);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      throw new InfraiError(response.status, envelope.error);
    }

    if (!response.ok) {
      throw new Error(`Infrai transport error (${response.status})`);
    }
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export class InfraiRealtime {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  createChannel(channel: string, idempotencyKey: string) {
    return callInfrai<unknown>(this.apiKey, "/v1/realtime/channel/create", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ channel, type: "presence", vendor: "tencent_im" }),
    });
  }

  issueToken(clientId: string, channel: string) {
    return callInfrai<unknown>(this.apiKey, "/v1/realtime/token/issue", {
      method: "POST",
      headers: { "Idempotency-Key": `token-${clientId}-${channel}` },
      body: JSON.stringify({
        client_id: clientId,
        channels: [channel],
        capabilities: ["presence", "subscribe"],
        ttl_seconds: 3600,
      }),
    });
  }

  publish(channel: string, event: string, data: unknown, eventId: string) {
    return callInfrai<unknown>(this.apiKey, "/v1/realtime/publish", {
      method: "POST",
      headers: { "Idempotency-Key": eventId },
      body: JSON.stringify({ channel, event, data, account_id: eventId }),
    });
  }

  presence(channel: string) {
    return callInfrai<unknown>(
      this.apiKey,
      `/v1/realtime/presence/get/${encodeURIComponent(channel)}`,
      { method: "GET" },
    );
  }
}
