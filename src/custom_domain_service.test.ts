import { strict as assert } from "node:assert";
import { advanceOrder, onboardStore, InfraiClient } from "./custom_domain_service.ts";

const start = { id: "order-17", total: 42, status: "checkout" as const };
assert.equal(advanceOrder(start, "payment_captured").status, "fulfilled");
assert.throws(() => advanceOrder(start, "shipment_confirmed"), /Cannot apply/);
console.log("order transition test passed");
const client = new InfraiClient("test-key");
const requests: Array<[string, string, Record<string, unknown> | undefined]> = [];
client.request = async <T>(method: string, path: string, body?: Record<string, unknown>) => {
  requests.push([method, path, body]);
  return (path.endsWith("/domain/add") ? { zone_id: "zone-17" } : {}) as T;
};
assert.deepEqual(await onboardStore(client, "shop.example.com", "https://shop.example.com/hooks/verification", "secret"), {
  domain: "shop.example.com", zone_id: "zone-17", state: "verification_pending"
});
assert.deepEqual(requests.map(([method, path]) => [method, path]), [
  ["POST", "/v1/dns/domain/add"],
  ["PUT", "/v1/dns/record/upsert"],
  ["POST", "/v1/account/webhooks/register"],
  ["POST", "/v1/dns/domain/verify"]
]);
assert.deepEqual(requests[2][2], {
  url: "https://shop.example.com/hooks/verification",
  events: ["account.updated"],
  secret: "secret",
  description: "Stop domain polling when verification finishes"
});
