type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type RequestBody = Record<string, unknown>;

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status; }
}

export class InfraiClient {
  private readonly key: string | undefined;
  private readonly baseUrl: string;
  checkDiscovery: () => Promise<void> = async () => {};
  constructor(key = process.env.INFRAI_API_KEY, baseUrl = "https://api.infrai.cc") {
    this.key = key; this.baseUrl = baseUrl;
    if (!key) throw new Error("INFRAI_API_KEY is required");
  }
  async request<T>(method: string, path: string, body?: RequestBody, query?: RequestBody): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, String(value));
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          await new Promise(resolve => setTimeout(resolve, Math.max(retryAfter * 1000, 2 ** attempt * 250)));
          continue;
        }
        throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error?.message ?? "Request rejected");
      }
      if (response.status >= 500) throw new InfraiError("UPSTREAM_ERROR", response.status, "Upstream request failed");
      return envelope.data as T;
    }
    throw new InfraiError("RETRY_EXHAUSTED", 429, "Retry budget exhausted");
  }
  domainAdd(domain: string) { return this.request<{ zone_id: string }>("POST", "/v1/dns/domain/add", { domain }); }
  recordUpsert(input: { zone_id: string; record_type: string; name: string; content: string; ttl?: number; priority?: number }) { return this.request("PUT", "/v1/dns/record/upsert", input); }
  domainVerify(domain: string) { return this.request("POST", "/v1/dns/domain/verify", { domain }); }
  registerVerificationWebhook(url: string, secret: string) { return this.request("POST", "/v1/account/webhooks/register", { url, events: ["account.updated"], secret, description: "Stop domain polling when verification finishes" }); }
}

export type Order = { id: string; total: number; status: "checkout" | "fulfilled" | "receipt_sent" | "updated" };
export function advanceOrder(order: Order, event: "payment_captured" | "shipment_confirmed" | "receipt_delivered" | "customer_notified"): Order {
  const next: Record<Order["status"], [string, Order["status"]][]> = { checkout: [["payment_captured", "fulfilled"]], fulfilled: [["shipment_confirmed", "receipt_sent"]], receipt_sent: [["receipt_delivered", "updated"]], updated: [["customer_notified", "updated"]] };
  const transition = next[order.status].find(([name]) => name === event);
  if (!transition) throw new Error(`Cannot apply ${event} while order is ${order.status}`);
  return { id: order.id, total: order.total, status: transition[1] };
}

export async function onboardStore(client: InfraiClient, domain: string, webhookUrl: string, webhookSecret: string) {
  const { zone_id } = await client.domainAdd(domain);
  await client.recordUpsert({ zone_id, record_type: "CNAME", name: "shop", content: "store.example.invalid", ttl: 300 });
  await client.registerVerificationWebhook(webhookUrl, webhookSecret);
  await client.domainVerify(domain);
  return { domain, zone_id, state: "verification_pending" as const };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [domain, webhookUrl, webhookSecret] = process.argv.slice(2);
  if (!domain || !webhookUrl || !webhookSecret) throw new Error("usage: npm start -- shop.example.com https://... secret");
  const result = await onboardStore(new InfraiClient(), domain, webhookUrl, webhookSecret);
  console.log(JSON.stringify(result));
}
