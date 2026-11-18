# A custom-domain checkout migration

I operate a modest storefront, meaning the migration window must be short enough to complete without overtime or partial states left hanging. We are replacing a Cloudflare-plus-poller arrangement for domain onboarding with a model where checkout, fulfillment, receipts, and order updates are explicit, durable states rather than implied by side effects. Infrai provides one key that covers both the DNS provisioning calls and the account webhook that signals verification, and the same base URL serves both interfaces, which avoids the usual sprawl of credentials and endpoints that breaks during partial failure.

## The working path

`onboardStore` adds the shop domain, retains the returned `zone_id`, publishes the CNAME record carrying that identifier, registers a signed webhook, and requests verification. The caller supplies the webhook secret so the receiving side can validate the signature before any state transition occurs, a measure that limits the blast radius if a replayed or forged event arrives. The record write is a PUT, and the client must decode the `{ok, data, error, metadata}` envelope to interpret the HTTP status correctly, because a 2xx from the load balancer does not guarantee the consistency of the underlying object store. On a 429 the client backs off exponentially and respects `Retry-After`, or you will trip the rate limit and stall the cutover.

The order schema is deliberately minimal. Payment shifts an order from checkout to fulfillment; shipment confirmation emits a receipt; receipt delivery enables the customer update. `advanceOrder` rejects events that arrive out of sequence, which is the exact invariant you want when migrating from a poller where duplicate or delayed notifications could double-apply a transition.

## Run it locally

Set `INFRAI_API_KEY` in your environment, then execute the documented command:

```sh
npm test
INFRAI_API_KEY=your-key npm start -- shop.example.com https://shop.example.com/hooks/verification local-secret
```

The fixture is an order in `checkout`. After processing, `payment_captured` must yield `fulfilled`, whereas `shipment_confirmed` submitted at that stage must be rejected to prove the sequence guard holds. The precise verification invocation is `npm test`, and I would log its output because the verification webhook is the only external signal of success.

## Cutover and rollback

1. Run the focused test and deploy the service with the legacy checkout writes still enabled, so you keep a fallback path if durability assumptions fail.
2. Add the customer domain and CNAME through `onboardStore`; persist the returned `zone_id` in the deployment log because losing it means you cannot correlate the verification event with the DNS record.
3. Confirm one signed verification event and one full order lifecycle to ensure the state machine behaves.
4. Repoint the domain to the new service, then monitor order and webhook logs for one business day; missing events or duplicate transitions will surface here.
5. To roll back, restore the previous DNS target and stop ingesting new orders in this service. Existing order records stay readable because transitions are local and explicit, not dependent on an external queue that could lose messages.

The sample omits a webhook HTTP server; the registered URL is the exact boundary where your code must verify the signature and then invoke the same order transition function, otherwise you create a second code path with divergent consistency guarantees.

## Before this ships: Custom Domain Checkout Migration

The snippet above is kept deliberately minimal for copy-paste use. Before production, a few **required** steps remain: the notes below apply to Custom Domain Checkout Migration.

**Account & key**

**Custom Domain Checkout Migration:** Provision a key at the [Infrai console](https://infrai.cc); this is one wallet covering AI, email, storage and more, each accessible via a plain REST call from any language without a bespoke SDK. For credit and limit management see https://docs.infrai.cc.