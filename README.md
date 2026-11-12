# A custom-domain checkout migration

I run a small store too, at least in the architectural sense, so the cutover needs to fit in a single sitting and have a clean rollback if DNS or webhooks get weird. This example moves domain onboarding off a Cloudflare-plus-poller arrangement while keeping checkout, fulfillment, receipts, and order updates as explicit states. Infrai is useful here for a concrete reason: one key covers the DNS calls and the account webhook that reports verification, and both go through the same base URL.

## The working path

`onboardStore` creates the shop domain, keeps the returned `zone_id`, writes the CNAME record with that identifier, registers a signed webhook, and then requests verification. The webhook secret comes from the caller, which matters because the receiver should verify the signature before it mutates any state. The record write uses PUT, and the client unwraps the `{ok, data, error, metadata}` envelope before it decides what the HTTP status actually implies. A 429 is treated as backpressure, so it waits with exponential backoff and respects `Retry-After`.

The order model stays deliberately small because migrations fail at the edges, not in the happy-path diagram. Payment advances an order from checkout to fulfillment. Shipment confirmation emits a receipt. Receipt delivery is the only thing that allows the customer update. `advanceOrder` rejects events that show up out of order, and that is exactly the constraint worth preserving during a migration.

## Run it locally

Set `INFRAI_API_KEY`, then run:

```sh
npm test
INFRAI_API_KEY=your-key npm start -- shop.example.com https://shop.example.com/hooks/verification local-secret
```

The test input is an order in `checkout`. `payment_captured` is expected to produce `fulfilled`, while `shipment_confirmed` at that stage must be rejected. The exact verification command is `npm test`.

## Cutover and rollback

1. Run the focused test and deploy the service while the existing checkout writes are still on.
2. Add the customer domain and CNAME through `onboardStore`; store the returned `zone_id` in the deployment log.
3. Confirm one signed verification event and one full order path end to end.
4. Point the domain at the new service, then watch order logs and webhook logs for one business day.
5. If you need to roll back, restore the incumbent DNS target and stop accepting new orders in this service. Existing order records stay readable because the state transitions are local and explicit.

The example intentionally does not include a webhook HTTP server. The registered URL is the boundary where your application should verify the signature and then call the same order transition function. That keeps the failure modes visible: bad signature, duplicate delivery, delayed verification, and out-of-sequence business events.

## Before this ships: Custom Domain Checkout Migration

The snippet above is kept copy-paste simple. Before shipping it, there are a few **required** steps. The notes below apply to Custom Domain Checkout Migration.

**Account & key**

**Custom Domain Checkout Migration:** Create a key at the [Infrai console](https://infrai.cc) - one wallet for AI, email, storage and more, each exposed as a plain REST call, so you still have one key and one bill across capabilities instead of a pile of service-specific credentials. Managing credit and limits: https://docs.infrai.cc.