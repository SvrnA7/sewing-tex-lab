import { createHmac, timingSafeEqual } from "node:crypto";
import { STAGES, type Order, type Stage } from "../shared/types";
import { dropDemoOrders, getDb, saveDb } from "./store";

const domain = () => process.env.SHOPIFY_STORE_DOMAIN?.trim();
const token = () => process.env.SHOPIFY_ADMIN_TOKEN?.trim();
const apiVersion = () => process.env.SHOPIFY_API_VERSION || "2025-10";
const leadDays = () => Number(process.env.DEFAULT_LEAD_DAYS || 5);
const STAGE_TAG_PREFIX = "naehstatus:";

export const shopifyConfigured = () => Boolean(domain() && token());

let lastError: string | undefined;
export const shopifyLastError = () => lastError;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${domain()}/admin/api/${apiVersion()}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token()! },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

const ORDERS_QUERY = /* GraphQL */ `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt note tags displayFinancialStatus displayFulfillmentStatus cancelledAt
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { displayName }
        customAttributes { key value }
        lineItems(first: 30) { nodes { title variantTitle quantity } }
      }
    }
  }
`;

interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  note: string | null;
  tags: string[];
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  cancelledAt: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { displayName: string } | null;
  customAttributes: { key: string; value: string | null }[];
  lineItems: { nodes: { title: string; variantTitle: string | null; quantity: number }[] };
}

function parseDueDate(node: ShopifyOrderNode): string {
  const attr = node.customAttributes.find((a) => /liefer|fällig|faellig|due|deadline|termin/i.test(a.key));
  if (attr?.value) {
    const v = attr.value.trim();
    const de = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    const d = de ? new Date(Number(de[3].length === 2 ? `20${de[3]}` : de[3]), Number(de[2]) - 1, Number(de[1]), 18) : new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(node.createdAt);
  d.setDate(d.getDate() + leadDays());
  return d.toISOString();
}

function stageFromTags(tags: string[]): Stage | undefined {
  const tag = tags.find((t) => t.toLowerCase().startsWith(STAGE_TAG_PREFIX));
  if (!tag) return undefined;
  const value = tag.slice(STAGE_TAG_PREFIX.length).trim().toLowerCase();
  return STAGES.find((s) => s.toLowerCase() === value);
}

function toOrder(node: ShopifyOrderNode, existing?: Order): Order {
  const tagStage = stageFromTags(node.tags);
  const fulfilled = node.displayFulfillmentStatus === "FULFILLED";
  const initialStage: Stage = tagStage ?? (fulfilled ? "Fertig" : "Offen");
  const base: Order = {
    id: node.id,
    name: node.name,
    source: "shopify",
    customer: node.customer?.displayName ?? "Gast",
    items: node.lineItems.nodes.map((li) => ({ title: li.title, variant: li.variantTitle ?? "", quantity: li.quantity })),
    total: Number(node.totalPriceSet.shopMoney.amount),
    currency: node.totalPriceSet.shopMoney.currencyCode,
    createdAt: node.createdAt,
    dueDate: parseDueDate(node),
    stage: initialStage,
    priority: node.tags.some((t) => /prio|eilig|express/i.test(t)),
    notes: node.note ?? "",
    financialStatus: node.displayFinancialStatus ?? undefined,
    fulfillmentStatus: node.displayFulfillmentStatus,
    stageHistory: [{ stage: initialStage, at: node.createdAt }],
    completedAt: initialStage === "Fertig" ? node.createdAt : undefined,
  };
  if (!existing) return base;
  // Lokale Produktionsdaten (Stand, Notizen, Fälligkeit, Priorität) bleiben erhalten,
  // Shopify liefert Kunde, Positionen, Summe und Zahlungs-/Versandstatus.
  return {
    ...base,
    stage: existing.stage,
    stageHistory: existing.stageHistory,
    completedAt: existing.completedAt,
    dueDate: existing.dueDate,
    priority: existing.priority || base.priority,
    notes: existing.notes || base.notes,
  };
}

/** Holt Bestellungen der letzten `days` Tage aus Shopify und führt sie mit dem lokalen Stand zusammen. */
export async function syncShopifyOrders(days = 120): Promise<{ imported: number; updated: number }> {
  if (!shopifyConfigured()) throw new Error("Shopify ist nicht konfiguriert (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN).");
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const query = `created_at:>=${since.toISOString().slice(0, 10)} -status:cancelled`;

  const nodes: ShopifyOrderNode[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < 10; page++) {
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } } =
        await gql(ORDERS_QUERY, { first: 100, after, query });
      nodes.push(...data.orders.nodes);
      if (!data.orders.pageInfo.hasNextPage) break;
      after = data.orders.pageInfo.endCursor;
    }
    lastError = undefined;
  } catch (err) {
    lastError = (err as Error).message;
    throw err;
  }

  dropDemoOrders();
  let imported = 0;
  let updated = 0;
  for (const node of nodes) {
    if (node.cancelledAt) continue;
    const idx = db.orders.findIndex((o) => o.id === node.id);
    if (idx === -1) {
      db.orders.push(toOrder(node));
      imported++;
    } else {
      db.orders[idx] = toOrder(node, db.orders[idx]);
      updated++;
    }
  }
  db.lastShopifySync = new Date().toISOString();
  saveDb();
  return { imported, updated };
}

/** Schreibt den Produktionsstand optional als Tag zurück an die Shopify-Bestellung. */
export async function pushStageTag(order: Order, previous: Stage) {
  if (!shopifyConfigured() || process.env.SHOPIFY_WRITE_STAGE_TAGS !== "true" || order.source !== "shopify") return;
  if (!order.id.startsWith("gid://")) return;
  await gql(
    /* GraphQL */ `
      mutation StageTags($id: ID!, $add: [String!]!, $remove: [String!]!) {
        tagsRemove(id: $id, tags: $remove) { userErrors { field message } }
        tagsAdd(id: $id, tags: $add) { userErrors { field message } }
      }
    `,
    { id: order.id, add: [`${STAGE_TAG_PREFIX}${order.stage}`], remove: [`${STAGE_TAG_PREFIX}${previous}`] },
  );
}

/** Prüft die HMAC-Signatur eines Shopify-Webhooks. */
export function verifyWebhook(rawBody: Buffer, hmacHeader: string | undefined): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(hmacHeader, "base64");
  return given.length === digest.length && timingSafeEqual(given, digest);
}

/** Webhook-Payload (REST-Format) → Order. Wird bei orders/create und orders/updated genutzt. */
export function upsertFromWebhook(payload: any) {
  const db = getDb();
  const id = payload.admin_graphql_api_id as string;
  const node: ShopifyOrderNode = {
    id,
    name: payload.name,
    createdAt: payload.created_at,
    note: payload.note,
    tags: String(payload.tags ?? "").split(",").map((t: string) => t.trim()).filter(Boolean),
    displayFinancialStatus: payload.financial_status?.toUpperCase() ?? null,
    displayFulfillmentStatus: payload.fulfillment_status === "fulfilled" ? "FULFILLED" : "UNFULFILLED",
    cancelledAt: payload.cancelled_at,
    totalPriceSet: { shopMoney: { amount: payload.total_price, currencyCode: payload.currency } },
    customer: payload.customer ? { displayName: [payload.customer.first_name, payload.customer.last_name].filter(Boolean).join(" ") } : null,
    customAttributes: (payload.note_attributes ?? []).map((a: any) => ({ key: a.name, value: a.value })),
    lineItems: { nodes: (payload.line_items ?? []).map((li: any) => ({ title: li.title, variantTitle: li.variant_title, quantity: li.quantity })) },
  };
  dropDemoOrders();
  const idx = db.orders.findIndex((o) => o.id === id);
  if (node.cancelledAt) {
    if (idx !== -1) db.orders.splice(idx, 1);
  } else if (idx === -1) {
    db.orders.push(toOrder(node));
  } else {
    db.orders[idx] = toOrder(node, db.orders[idx]);
  }
  saveDb();
}
