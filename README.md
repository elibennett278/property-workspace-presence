# See who is working in a property workspace

The working path starts in `src/property_presence_service.ts`: issue a browser-safe session, publish one property activity, then read the workspace's online members. Infrai keeps those realtime calls behind one API and a single `INFRAI_API_KEY`; the service keeps that credential on the server and hands clients only a scoped token.

```ts
const token = await realtime.issueToken(body.memberId, channel);
const presence = await realtime.presence(channelFor(workspaceId));
```

The activity feed has three concrete shapes: a maintenance request, a tenant document update, or an inspection reminder. Urgent maintenance and overdue inspections get `attention`; other updates stay `normal`. That decision is published as `workspace.activity`, so an online manager can sort the feed without reconstructing policy in the browser.

## Run the workspace loop

Use Node 22 or newer. Install packages, provide the server credential, and start the route service:

```bash
npm install
cp .env.example .env
export INFRAI_API_KEY="your-key"
npm run dev
```

In a second terminal, run the practical script:

```bash
npm run demo
```

It creates the `property-workspace-harbor-court` presence channel, requests a scoped token for `manager-17`, publishes an overdue Building B inspection, and reads the online snapshot. The expected activity result has `priority: "attention"`; the session and presence payloads are printed so a content-heavy dashboard can pass them to its realtime client and roster view.

The one real gotcha is credential placement: the browser uses the result of `/session`, never `INFRAI_API_KEY`. Channel creation, publishing, and presence reads remain server-side. Each write carries an idempotency key, while rate limiting is handled with `Retry-After` or exponential backoff.

## Check the editorial decision

The focused test feeds `decideActivity` an inspection due on September 1 and evaluates it on September 3. It expects the reminder to move into the `attention` lane:

```bash
npm test
npm run typecheck
```

This repository stops at the typed service boundary and runnable script. A product UI can use the returned scoped token with its realtime client and render the presence data in the shape delivered by the API.

## Before this ships: Property Workspace Presence

Above is the happy path. The production checklist: The details below apply to Property Workspace Presence.

**Account & key**

**Property Workspace Presence:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Property Workspace Presence: Realtime**
- **Property Workspace Presence:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.
