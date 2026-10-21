# Live Auction Realtime API: Bidding Ordering Under Reconnect Pressure

Accept bids through one authoritative ordering path, commit each accepted bid before broadcasting it, and make every room event replayable by sequence number. For a small B2B SaaS team, that is the most defensible realtime API approach: fairness comes from the server's admission rule and durable order, not from whichever bidder's network packet reaches a browser first.

TL;DR: Treat the live room as a replicated view of an auction log. A reconnecting client sends its last applied sequence, receives the missing committed events, and then resumes the live stream. Use idempotency keys on commands, monotonic room-local sequence numbers on events, and explicit rejection responses. WebRTC may carry low-latency peer data, but its specification does not turn peers into an authoritative auction sequencer; keep bid admission on the server side.

## How should a realtime API order live auction bidding?

It needs a written rule before it needs a transport. A practical rule is: the auction service accepts or rejects commands in the order assigned by its single logical writer for that auction, subject to the auction's open state and bid validation. The committed sequence is the observable order. Client clocks, animation time, and message arrival at other clients do not decide a winner.

This choice has a cost. A single logical writer limits how one auction can scale, and routing or leadership changes need care. The benefit is a reviewable decision point: two simultaneous bids cannot both claim the same position in the room history. Different auctions can still be processed independently. For a small team, that boundary is easier to operate than trying to reconcile several writers after they have announced conflicting winners.

Sequence first.

Do not promise exactly-once delivery to browsers. Reconnects, retries, and uncertain acknowledgements mean an event can be observed more than once. Instead, make command handling idempotent and event application duplicate-tolerant. **The invariant is one committed result per command key, not one network delivery.**

The same room log can carry bids and operator chat, but they should not share admission rules. A delayed chat message is inconvenient. A delayed bid near close can change the outcome. Give each event a type, validate bids against authoritative auction state, and keep cosmetic presence updates out of the bid sequence if they do not need the same durability.

This approach has a real limitation: it is a poor fit when one auction must accept more writes than a single ordering partition can process. Splitting that auction across independent writers would sacrifice the simple total order. The team must then either constrain admission, partition the business rules so bids no longer compete in one order, or adopt a consensus-backed sequencer and accept the extra operational complexity. That is a capacity trade-off, not a transport feature. For rooms where messages do not compete for a winner, independent writers and weaker ordering can be the better design because they avoid an unnecessary serialization point.

## Put the commit before fan-out

The dangerous ordering is broadcast first, persist second. If persistence fails after clients render a leading bid, the room has shown a state the authority cannot recover. Reverse those actions: validate the command, atomically store its result and next room sequence, then publish the committed event.

Fail closed.

Keep the write contract narrow. A bid command needs an auction identifier, bidder identity established by the authenticated session, amount, and an idempotency key. The server response should identify the resulting committed event or the stable rejection. Do not accept a client-supplied timestamp as ordering authority.

A compact Go model makes the boundaries visible even if the production service is implemented in Node.js. The transaction and publisher are interfaces on purpose; correctness belongs in their contract, not in a framework callback.

```go
package auction

import (
    "context"
    "errors"
)

type Bid struct {
    AuctionID      string
    BidderID       string
    IdempotencyKey string
    AmountMinor    int64
}

type Event struct {
    AuctionID   string
    Sequence    uint64
    Kind        string
    AmountMinor int64
    BidderID    string
}

type Store interface {
    CommitBid(ctx context.Context, bid Bid) (Event, bool, error)
}

type Publisher interface {
    Publish(ctx context.Context, event Event) error
}

type Service struct {
    store     Store
    publisher Publisher
}

func (s Service) PlaceBid(ctx context.Context, bid Bid) (Event, error) {
    if bid.AuctionID == "" || bid.BidderID == "" ||
        bid.IdempotencyKey == "" || bid.AmountMinor <= 0 {
        return Event{}, errors.New("invalid bid command")
    }

    event, committed, err := s.store.CommitBid(ctx, bid)
    if err != nil {
        return Event{}, err
    }
    if !committed {
        return event, nil // Stable result for an already-seen key.
    }

    // Publication may be retried; consumers deduplicate by auction and sequence.
    if err := s.publisher.Publish(ctx, event); err != nil {
        return event, err
    }
    return event, nil
}
```

The example exposes an operational wrinkle: returning a publish error after commit can cause a caller to retry. That is acceptable only if `CommitBid` returns the same result for the same bidder-scoped key. Production delivery should also have a durable way to retry committed-but-not-yet-published events; otherwise a process exit between commit and publish creates a silent gap.

Tiny gap, large incident.

## Make reconnect a replay protocol

Each client stores the highest contiguous sequence it has applied for the auction room. On connection it requests events after that cursor. The server replays committed events in ascending order and then hands the connection into live delivery without leaving a gap between the two phases. If the client receives sequence 418 after 416, it pauses application, requests the missing range beginning at 417, and deduplicates anything repeated during recovery.

A snapshot can shorten long replays. It must include the sequence through which it is valid; otherwise the client cannot know where incremental events begin. This is a correctness field, not metadata.

Use explicit room states such as scheduled, open, and closed. The authoritative writer checks the state while admitting the bid. A timer may request closure, but the serialized transition in the same ordering domain determines whether a competing bid was accepted before or after close. Wall-clock displays remain useful to humans, yet they cannot resolve a race between independent machines.

WebRTC defines peer connections and data channels, which can be useful for room media or peer data. That topology changes the failure surface: peers can disconnect independently, and there is no inherent single auction authority among them. For bids, route commands to the authoritative service and distribute committed events to every client. **Transport latency affects responsiveness; it must not redefine order.**

## Operate the guarantees, not the socket count

Monitor the sequence lifecycle. The useful signals are admission latency, commit-to-publish delay, replay length, replay failures, rejected duplicate commands, sequence-gap recoveries, and the age of the oldest committed event awaiting publication. Connection count is capacity data, but it will not tell you that clients are converging on the wrong winner.

Alert on stalled progress rather than a single transient retry. A room whose latest committed sequence keeps advancing while its published sequence does not is actionable. So is a sustained rise in gap recovery for one deployment cohort. Logs should join command key, auction ID, committed sequence, and publish attempt without recording credentials or unnecessary bidder data.

Test the ugly boundaries deliberately:

1. Send the same command key twice before and after reconnect; both calls must resolve to one committed event.
2. Drop the connection after commit but before the acknowledgement reaches the client; retry must return the original result.
3. Deliver events out of order and with duplicates; the view must stop at the gap and converge after replay.
4. Race a close transition with several bids; repeated runs must obey the documented serialized order.
5. Restart the publisher with committed work pending; delivery must resume without inventing a new sequence.

Load tests should skew toward a few hot auctions rather than distribute traffic evenly across thousands of quiet rooms. The contention point is per-auction ordering. Measure the longest replay and the slowest admission path separately; an attractive median can hide the exact tail that bidders encounter near close.

## Deploy and roll back without changing history

Make schema changes additive first. New readers should tolerate events produced by the previous release, and old readers should ignore fields they do not understand when that behavior is explicitly part of the event contract. Do not reuse an event kind with a changed meaning. Once a sequence is committed, deployment code must never renumber or rewrite it.

Use a staged rollout with invariant checks on both versions. Compare committed and published high-water marks, duplicate-key outcomes, and client gap reports. If the new release degrades delivery, stop routing new commands to it and restore the previous publisher while preserving the shared log. **Rollback changes code, never auction history.**

The runbook should separate three cases. If admission is unavailable, reject or fail closed rather than queue bids on an untrusted client clock. If publication is delayed, retain committed results and catch clients up through replay. If a client view is inconsistent, discard its derived state and rebuild from a sequence-stamped snapshot plus subsequent events. Those responses protect the authority boundary while giving operators a clear recovery path.

For a small SaaS team, the decision rule is plain: choose components only after proving they support one logical writer per auction, atomic idempotent admission, durable publication retry, cursor replay, and observable sequence gaps. Protocol choice comes later. The room can survive reconnects because its truth lives in an ordered log, while every socket remains replaceable.

## References

- W3C, WebRTC 1.0: Real-Time Communication Between Browsers: https://www.w3.org/TR/webrtc/
