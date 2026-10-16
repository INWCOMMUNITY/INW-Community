import {
  prisma,
  replaceListingBuyerFields,
  validateListingBuyerFields,
  type ListingBuyerFieldInput,
  type NormalizedListingBuyerField,
  type ShopifyJobHandlerResult,
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
  const key = (field.key ?? "").trim();
  if (key === SHOPIFY_LISTING_EXPORT_METAFIELD_KEY) return true;
  // Shopify returns app-owned `$app` metafields under `app--{id}`, not `$app`.
  const name = field.definition?.name?.trim();
  return name === "INW listing export ID" && (field.type ?? "").trim() === "id";
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
    await replaceListingBuyerFields(prisma, input.storeItemId, classified.buyerFields, {
      personalizationDirty: true,
    });
  }
  return { incompatible: classified.incompatible };
}

const BUYER_METAFIELD_NAMESPACE = "custom";

export type ShopifyBuyerMetafieldWrite = {
  namespace: string;
  key: string;
  type: string;
  name: string;
  description: string | null;
  value: string | null;
  validations: Array<{ name: string; value: string }>;
  /** Pinned definitions show on the product page in Shopify admin. */
  pin: boolean;
  createDefinition: boolean;
};

type BuyerMetafieldSource = {
  kind: "TEXT" | "DROPDOWN" | "FILE";
  title: string;
  instructions: string | null;
  maxCharacters: number | null;
  options: string[];
};

type RemoteBuyerMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string | null;
  name: string | null;
};

function titleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function sameQuestion(row: RemoteBuyerMetafield, field: BuyerMetafieldSource): boolean {
  const title = field.title.trim().toLowerCase();
  const name = (row.name ?? "").trim().toLowerCase();
  if (name && name === title) return true;
  const slug = titleSlug(field.title);
  if (slug.length < 2) return false;
  const key = row.key.trim().toLowerCase();
  return key === slug || key === `inw_${slug}`;
}

function slugMetafieldKey(title: string, position: number, used: Set<string>): string {
  const slug = titleSlug(title);
  const base = `inw_${slug.length >= 2 ? slug : `option_${position + 1}`}`;
  let candidate = base.slice(0, 64);
  let n = 2;
  while (used.has(`${BUYER_METAFIELD_NAMESPACE}:${candidate}`)) {
    candidate = `${base.slice(0, 58)}_${n}`.slice(0, 64);
    n += 1;
  }
  used.add(`${BUYER_METAFIELD_NAMESPACE}:${candidate}`);
  return candidate;
}

function typeFits(kind: BuyerMetafieldSource["kind"], type: string): boolean {
  if (kind === "TEXT") return type === "single_line_text_field" || type === "multi_line_text_field";
  if (kind === "DROPDOWN") return type === "single_line_text_field";
  return type === "file_reference" || type === "list.file_reference";
}

function desiredType(field: BuyerMetafieldSource): string {
  if (field.kind === "FILE") return "file_reference";
  if (field.kind === "DROPDOWN") return "single_line_text_field";
  return (field.maxCharacters ?? 256) > 255 ? "multi_line_text_field" : "single_line_text_field";
}

/** Value written onto the Shopify product. File questions only create the definition. */
export function shopifyBuyerMetafieldValue(
  field: BuyerMetafieldSource,
  remoteValue: string | null,
  type: string
): string | null {
  if (field.kind === "FILE") return null;
  if (field.kind === "DROPDOWN") {
    const labels = field.options.map((label) => label.trim()).filter(Boolean);
    if (remoteValue && labels.includes(remoteValue)) return remoteValue;
    return labels[0] ?? null;
  }
  const instructions = field.instructions?.trim() ?? "";
  const limit = field.maxCharacters ?? (type === "single_line_text_field" ? 255 : 5000);
  const raw = instructions || remoteValue?.trim() || field.title;
  const text = type === "single_line_text_field" ? raw.replace(/\s+/g, " ").trim() : raw;
  return text.slice(0, Math.max(1, limit));
}

export function planShopifyBuyerMetafieldWrites(
  fields: BuyerMetafieldSource[],
  remote: RemoteBuyerMetafield[]
): ShopifyBuyerMetafieldWrite[] {
  const used = new Set(remote.map((row) => `${row.namespace}:${row.key}`));
  const taken = new Set<number>();
  return fields.map((field, position) => {
    const matchIndex = remote.findIndex((row, index) => {
      if (taken.has(index)) return false;
      if (row.namespace === SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE) return false;
      if (!sameQuestion(row, field)) return false;
      return typeFits(field.kind, row.type);
    });
    const matched = matchIndex >= 0 ? remote[matchIndex] : null;
    if (matchIndex >= 0) taken.add(matchIndex);
    const type = matched ? matched.type : desiredType(field);
    const namespace = matched?.namespace || BUYER_METAFIELD_NAMESPACE;
    const key = matched?.key || slugMetafieldKey(field.title, position, used);
    const labels = field.options.map((label) => label.trim()).filter(Boolean);
    const validations =
      field.kind === "DROPDOWN"
        ? [{ name: "choices", value: JSON.stringify(labels) }]
        : field.kind === "TEXT" && field.maxCharacters
          ? [{ name: "max", value: String(field.maxCharacters) }]
          : [];
    const instructions = field.kind === "DROPDOWN" ? "" : (field.instructions?.trim() ?? "");
    return {
      namespace,
      key,
      type,
      name: field.title.trim().slice(0, 255),
      description: instructions ? instructions.slice(0, 255) : null,
      value: shopifyBuyerMetafieldValue(field, matched?.value ?? null, type),
      validations,
      pin: true,
      createDefinition: !matched,
    };
  });
}

function metafieldFailure(result: {
  class: string;
  message: string;
}): Extract<ShopifyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  const transient =
    result.class === "THROTTLED" ||
    result.class === "TRANSIENT_PROVIDER" ||
    result.class === "NETWORK_UNKNOWN";
  if (transient) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: result.class,
      errorMessage: result.message,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: "PERMANENT",
    errorCode: result.class || "METAFIELD_WRITE",
    errorMessage: result.message,
  };
}

/** Write INW custom options onto the Shopify product as metafields. */
export async function pushShopifyBuyerMetafields(input: {
  connectionId: string;
  shopifyProductId: string;
  storeItemId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<Extract<ShopifyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> | null> {
  const rows = await prisma.listingBuyerField.findMany({
    where: { storeItemId: input.storeItemId },
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  });
  if (rows.length === 0) return null;

  const { executeShopifyAdminGraphql } = await import("./admin-graphql");
  const read = await executeShopifyAdminGraphql<{
    product: {
      metafields: {
        nodes: Array<{
          namespace: string;
          key: string;
          type: string;
          value: string | null;
          definition: { name: string | null } | null;
        }>;
      } | null;
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyBuyerMetafieldRead",
    fetchImpl: input.fetchImpl,
    now: input.now,
    document: `query ShopifyBuyerMetafieldRead($id: ID!) {
      product(id: $id) {
        metafields(first: 50) {
          nodes { namespace key type value definition { name } }
        }
      }
    }`,
    variables: { id: input.shopifyProductId },
  });
  if (!read.ok) return metafieldFailure(read);
  if (!read.data?.product) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "METAFIELD_READ",
      errorMessage: "Shopify product was not found",
    };
  }

  const remote = (read.data.product.metafields?.nodes ?? []).map((node) => ({
    namespace: node.namespace,
    key: node.key,
    type: node.type,
    value: node.value,
    name: node.definition?.name ?? null,
  }));
  const writes = planShopifyBuyerMetafieldWrites(
    rows.map((row) => ({
      kind: row.kind,
      title: row.title,
      instructions: row.instructions,
      maxCharacters: row.maxCharacters,
      options: row.options.map((option) => option.label),
    })),
    remote
  );

  const definitionError = await saveBuyerMetafieldDefinitions({
    connectionId: input.connectionId,
    writes: writes.filter((write) => write.createDefinition),
    create: true,
    fetchImpl: input.fetchImpl,
    now: input.now,
    execute: executeShopifyAdminGraphql,
  });
  if (definitionError) return definitionError;

  const metafields = writes
    .filter((write): write is ShopifyBuyerMetafieldWrite & { value: string } => Boolean(write.value))
    .map((write) => ({
      ownerId: input.shopifyProductId,
      namespace: write.namespace,
      key: write.key,
      type: write.type,
      value: write.value,
    }));
  if (metafields.length === 0) {
    return saveBuyerMetafieldDefinitions({
      connectionId: input.connectionId,
      writes: writes.filter((write) => !write.createDefinition),
      create: false,
      fetchImpl: input.fetchImpl,
      now: input.now,
      execute: executeShopifyAdminGraphql,
    });
  }
  const set = await executeShopifyAdminGraphql<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyBuyerMetafieldsSet",
    fetchImpl: input.fetchImpl,
    now: input.now,
    document: `mutation ShopifyBuyerMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message code }
      }
    }`,
    variables: { metafields },
  });
  if (!set.ok) return metafieldFailure(set);
  const setErrors = set.data?.metafieldsSet?.userErrors ?? [];
  if (setErrors.length > 0) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "METAFIELD_SET",
      errorMessage: setErrors[0]?.message ?? "Could not fill Shopify metafields",
    };
  }

  // Values are written first. Definition updates (choice list, character limit, pin)
  // follow so an existing value can already satisfy the new rules.
  return saveBuyerMetafieldDefinitions({
    connectionId: input.connectionId,
    writes: writes.filter((write) => !write.createDefinition),
    create: false,
    fetchImpl: input.fetchImpl,
    now: input.now,
    execute: executeShopifyAdminGraphql,
  });
}

function definitionBody(write: ShopifyBuyerMetafieldWrite, pin: boolean) {
  return {
    name: write.name,
    namespace: write.namespace,
    key: write.key,
    ownerType: "PRODUCT",
    pin,
    // Admin shows the value. The Online Store can read it only when storefront access is public.
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    ...(write.description ? { description: write.description } : {}),
    ...(write.validations.length > 0 ? { validations: write.validations } : {}),
  };
}

function definitionErrors(
  data: unknown,
  field: "metafieldDefinitionCreate" | "metafieldDefinitionUpdate"
): Array<{ message: string; code?: string }> {
  const payload = data as
    | {
        metafieldDefinitionCreate?: { userErrors?: Array<{ message: string; code?: string }> };
        metafieldDefinitionUpdate?: { userErrors?: Array<{ message: string; code?: string }> };
      }
    | null;
  return payload?.[field]?.userErrors ?? [];
}

function definitionAlreadyExists(errors: Array<{ message: string; code?: string }>): boolean {
  return errors.some(
    (error) =>
      error.code === "TAKEN" ||
      error.code === "PRESENT" ||
      /taken|already exists|in use/i.test(error.message)
  );
}

async function saveBuyerMetafieldDefinitions(input: {
  connectionId: string;
  writes: ShopifyBuyerMetafieldWrite[];
  create: boolean;
  fetchImpl?: ShopifyFetch;
  now?: Date;
  execute: typeof import("./admin-graphql").executeShopifyAdminGraphql;
}): Promise<Extract<ShopifyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> | null> {
  for (const write of input.writes) {
    const run = (pin: boolean) =>
      input.create
        ? input.execute<{ metafieldDefinitionCreate: { userErrors: Array<{ message: string; code?: string }> } }>({
            connectionId: input.connectionId,
            operationType: "mutation",
            operationName: "ShopifyBuyerMetafieldDefine",
            fetchImpl: input.fetchImpl,
            now: input.now,
            document: `mutation ShopifyBuyerMetafieldDefine($definition: MetafieldDefinitionInput!) {
              metafieldDefinitionCreate(definition: $definition) {
                createdDefinition { id }
                userErrors { field message code }
              }
            }`,
            variables: { definition: { ...definitionBody(write, pin), type: write.type } },
          })
        : input.execute<{ metafieldDefinitionUpdate: { userErrors: Array<{ message: string; code?: string }> } }>({
            connectionId: input.connectionId,
            operationType: "mutation",
            operationName: "ShopifyBuyerMetafieldUpdate",
            fetchImpl: input.fetchImpl,
            now: input.now,
            document: `mutation ShopifyBuyerMetafieldUpdate($definition: MetafieldDefinitionUpdateInput!) {
              metafieldDefinitionUpdate(definition: $definition) {
                updatedDefinition { id }
                userErrors { field message code }
              }
            }`,
            variables: { definition: definitionBody(write, pin) },
          });

    let saved = await run(write.pin);
    if (!saved.ok) return metafieldFailure(saved);
    const field = input.create ? "metafieldDefinitionCreate" : "metafieldDefinitionUpdate";
    let errors = definitionErrors(saved.data, field);
    if (write.pin && errors.some((error) => /pin/i.test(error.message))) {
      saved = await run(false);
      if (!saved.ok) return metafieldFailure(saved);
      errors = definitionErrors(saved.data, field);
    }
    if (errors.length > 0 && !(input.create && definitionAlreadyExists(errors))) {
      return {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "METAFIELD_DEFINITION",
        errorMessage: errors[0]?.message ?? "Could not save the Shopify metafield definition",
      };
    }
  }
  return null;
}
