import {
  prisma,
  replaceListingBuyerFields,
  validateListingBuyerFields,
  type ListingBuyerFieldInput,
  type NormalizedListingBuyerField,
} from "database";
import type { ShopifyFetch, ShopifyGraphqlResult } from "./admin-graphql";
import {
  SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
  SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
} from "./listing-export-id";

/**
 * Shopify product metafield types (Admin “Add product metafield definition”, 2026).
 * INW custom options match Etsy only: text box, one choice list, one file upload.
 *
 * Mapped:
 * - single_line_text_field → text (admin: Single line text, Email)
 * - single_line_text_field + choices → dropdown (admin: Choice list)
 * - multi_line_text_field → text
 * - file_reference → file (admin: File, Image). Video-only files are not mapped.
 * - list.file_reference → file, 1–10 files
 *
 * Not mapped (popup on import): boolean, color, date, date_time, dimension, id,
 * json, link, money, number_decimal, number_integer, rating, rich_text_field,
 * url, volume, weight, references (article, collection, company, customer,
 * metaobject, mixed, order, page, product, variant), list.single_line_text_field
 * (multi-select choice list), and every other list.* type.
 */
export const SHOPIFY_METAFIELD_NOTICE_PREFIX = "METAFIELD:";

const TYPE_LABELS: Record<string, string> = {
  boolean: "True or false",
  color: "Color",
  date: "Date",
  date_time: "Date and time",
  dimension: "Dimension",
  id: "ID",
  json: "JSON",
  link: "Link",
  money: "Money",
  multi_line_text_field: "Multi-line text",
  number_decimal: "Decimal",
  number_integer: "Integer",
  rating: "Rating",
  rich_text_field: "Rich text",
  single_line_text_field: "Single line text",
  url: "URL",
  volume: "Volume",
  weight: "Weight",
  article_reference: "Article",
  collection_reference: "Collection",
  company_reference: "Company",
  customer_reference: "Customer",
  file_reference: "File",
  metaobject_reference: "Metaobject",
  mixed_reference: "Mixed reference",
  order_reference: "Order",
  page_reference: "Page",
  product_reference: "Product",
  variant_reference: "Variant",
};

export type ShopifyMetafieldObservation = {
  namespace?: string | null;
  key?: string | null;
  type?: string | null;
  value?: string | null;
  definition?: {
    name?: string | null;
    validations?: Array<{ name?: string | null; value?: string | null } | null> | null;
  } | null;
};

export type IncompatibleShopifyMetafield = {
  name: string;
  typeLabel: string;
  reason: string;
};

function typeLabel(type: string): string {
  if (type.startsWith("list.")) {
    const inner = type.slice("list.".length);
    return `List of ${TYPE_LABELS[inner] ?? inner}`;
  }
  return TYPE_LABELS[type] ?? type;
}

function fieldName(field: ShopifyMetafieldObservation): string {
  const named = field.definition?.name?.trim();
  if (named) return named.slice(0, 80);
  const key = (field.key ?? "").replace(/[_-]+/g, " ").trim();
  return (key || "Metafield").slice(0, 80);
}

function validationValue(field: ShopifyMetafieldObservation, name: string): string | null {
  const found = field.definition?.validations?.find((row) => row?.name === name);
  return typeof found?.value === "string" ? found.value : null;
}

function jsonStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  } catch {
    return [];
  }
}

function videoOnly(field: ShopifyMetafieldObservation): boolean {
  const allowed = jsonStringList(validationValue(field, "file_type_options")).map((entry) =>
    entry.toLowerCase()
  );
  return allowed.length > 0 && allowed.every((entry) => entry === "video");
}

function textLimit(field: ShopifyMetafieldObservation): number {
  const max = Number(validationValue(field, "max"));
  if (Number.isInteger(max) && max >= 1 && max <= 1024) return max;
  return 256;
}

function isExportIdentity(field: ShopifyMetafieldObservation): boolean {
  return (
    field.namespace === SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE &&
    field.key === SHOPIFY_LISTING_EXPORT_METAFIELD_KEY
  );
}

export function classifyShopifyProductMetafields(fields: ShopifyMetafieldObservation[]): {
  buyerFields: NormalizedListingBuyerField[];
  incompatible: IncompatibleShopifyMetafield[];
} {
  const buyerFields: NormalizedListingBuyerField[] = [];
  const incompatible: IncompatibleShopifyMetafield[] = [];
  let fileTaken = false;

  for (const field of fields) {
    if (isExportIdentity(field)) continue;
    const type = (field.type ?? "").trim();
    const name = fieldName(field);
    const label = typeLabel(type || "unknown");
    const reject = (reason: string) => {
      incompatible.push({ name, typeLabel: label, reason });
    };

    if (buyerFields.length >= 5) {
      reject("INW and Etsy allow 5 custom options. This metafield was left off the listing.");
      continue;
    }

    let draft: ListingBuyerFieldInput | null = null;
    if (type === "single_line_text_field" || type === "multi_line_text_field") {
      const choices = type === "single_line_text_field" ? jsonStringList(validationValue(field, "choices")) : [];
      if (choices.length > 0) {
        draft = {
          kind: "DROPDOWN",
          title: name.slice(0, 45),
          required: false,
          options: choices.map((choice) => ({ label: choice.trim() })),
        };
      } else {
        draft = {
          kind: "TEXT",
          title: name.slice(0, 45),
          required: false,
          maxCharacters: textLimit(field),
        };
      }
    } else if (type === "file_reference" || type === "list.file_reference") {
      if (videoOnly(field)) {
        reject("Etsy file upload accepts images and PDF, not video.");
        continue;
      }
      if (fileTaken) {
        reject("Etsy allows one file upload question per listing.");
        continue;
      }
      const listed = type === "list.file_reference" ? jsonStringList(field.value ?? null).length : 1;
      if (type === "list.file_reference" && listed > 10) {
        reject("Etsy file upload allows at most 10 files.");
        continue;
      }
      fileTaken = true;
      draft = {
        kind: "FILE",
        title: name.slice(0, 45),
        required: false,
        maxFiles: Math.max(1, listed),
        labelEachFile: false,
      };
    } else if (type === "list.single_line_text_field") {
      reject("Etsy has a single choice list, not a multi-select list.");
      continue;
    } else {
      reject("This Shopify metafield type has no Etsy custom option.");
      continue;
    }

    const checked = validateListingBuyerFields([draft]);
    if (!checked.ok) {
      reject(checked.error);
      if (draft.kind === "FILE") fileTaken = false;
      continue;
    }
    buyerFields.push(checked.fields[0]!);
  }

  return { buyerFields, incompatible };
}

export function formatShopifyMetafieldNotice(items: IncompatibleShopifyMetafield[]): string {
  const body = items
    .map((item) => `${item.name} (${item.typeLabel}): ${item.reason}`)
    .join("; ");
  return `${SHOPIFY_METAFIELD_NOTICE_PREFIX} ${body}`.slice(0, 400);
}

type MetafieldQuery = {
  product: {
    metafields: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ShopifyMetafieldObservation[];
    } | null;
  } | null;
};

const METAFIELD_QUERY = `query ShopifyImportProductMetafields($id: ID!, $after: String) {
  product(id: $id) {
    metafields(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        namespace
        key
        type
        value
        definition {
          name
          validations { name value }
        }
      }
    }
  }
}`;

/** Read product metafields and store the Etsy-compatible ones as INW custom options. */
export async function importShopifyBuyerMetafields(input: {
  connectionId: string;
  shopifyProductId: string;
  storeItemId: string;
  fetchImpl?: ShopifyFetch;
}): Promise<{ incompatible: IncompatibleShopifyMetafield[] }> {
  const { executeShopifyAdminGraphql } = await import("./admin-graphql");
  const nodes: ShopifyMetafieldObservation[] = [];
  let after: string | null = null;
  let truncated = false;
  for (let page = 0; page < 4; page += 1) {
    const result: ShopifyGraphqlResult<MetafieldQuery> = await executeShopifyAdminGraphql<MetafieldQuery>({
      connectionId: input.connectionId,
      operationType: "query",
      operationName: "ShopifyImportProductMetafields",
      fetchImpl: input.fetchImpl,
      document: METAFIELD_QUERY,
      variables: { id: input.shopifyProductId, after },
    });
    if (!result.ok || !result.data?.product) {
      return {
        incompatible: [
          {
            name: "Shopify metafields",
            typeLabel: "Read failed",
            reason: result.ok
              ? "Could not read this product’s metafields, so custom options were not imported."
              : result.message,
          },
        ],
      };
    }
    const connection = result.data.product.metafields;
    nodes.push(...(connection?.nodes ?? []));
    if (!connection?.pageInfo.hasNextPage) {
      truncated = false;
      break;
    }
    truncated = true;
    after = connection.pageInfo.endCursor;
    if (!after) break;
  }
  const classified = classifyShopifyProductMetafields(nodes);
  if (truncated) {
    classified.incompatible.push({
      name: "Additional metafields",
      typeLabel: "Not read",
      reason: "This product has more metafields than the import reads. They were not checked.",
    });
  }
  if (classified.buyerFields.length > 0) {
    await replaceListingBuyerFields(prisma, input.storeItemId, classified.buyerFields);
  }
  return { incompatible: classified.incompatible };
}
