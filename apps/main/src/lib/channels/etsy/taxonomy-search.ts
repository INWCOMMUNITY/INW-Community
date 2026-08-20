/**
 * Search Etsy seller taxonomy for the listing picker.
 * Etsy has no category-suggestions endpoint; we flatten GET /seller-taxonomy/nodes
 * and score leaves locally.
 */

import { etsyGet, setEtsyConnectionContext } from "./client";

export type EtsyTaxonomyApiNode = {
  id?: number;
  name?: string;
  children?: EtsyTaxonomyApiNode[];
};

export type FlatEtsyCategory = {
  taxonomyId: number;
  name: string;
  path: string;
  isLeaf: boolean;
};

export type EtsyCategorySuggestion = {
  taxonomyId: number;
  categoryName: string;
  categoryPath: string;
};

const TREE_TTL_MS = 60 * 60 * 1000;
const SEARCH_LIMIT = 20;

let treeCache: { at: number; nodes: FlatEtsyCategory[] } | null = null;

export function flattenEtsyTaxonomyNodes(
  nodes: EtsyTaxonomyApiNode[],
  ancestors: string[] = []
): FlatEtsyCategory[] {
  const out: FlatEtsyCategory[] = [];
  for (const node of nodes) {
    const id = typeof node.id === "number" && node.id > 0 ? node.id : null;
    const name = node.name?.trim();
    if (id == null || !name) continue;
    const pathParts = [...ancestors, name];
    const children = Array.isArray(node.children) ? node.children : [];
    const isLeaf = children.length === 0;
    out.push({ taxonomyId: id, name, path: pathParts.join(" > "), isLeaf });
    if (children.length > 0) {
      out.push(...flattenEtsyTaxonomyNodes(children, pathParts));
    }
  }
  return out;
}

export function scoreEtsyCategoryMatch(query: string, node: FlatEtsyCategory): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = node.name.toLowerCase();
  const path = node.path.toLowerCase();
  let score = 0;
  if (name === q) score = 100;
  else if (name.startsWith(q)) score = 85;
  else if (name.includes(q)) score = 70;
  else if (path.split(" > ").some((segment) => segment.startsWith(q))) score = 55;
  else if (path.includes(q)) score = 40;
  if (score === 0) return 0;
  if (node.isLeaf) score += 8;
  return score;
}

export function searchFlattenedEtsyCategories(
  nodes: FlatEtsyCategory[],
  query: string,
  limit = SEARCH_LIMIT
): EtsyCategorySuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const ranked = nodes
    .filter((n) => n.isLeaf)
    .map((n) => ({ n, score: scoreEtsyCategoryMatch(q, n) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.n.path.length - b.n.path.length);

  const seen = new Set<number>();
  const out: EtsyCategorySuggestion[] = [];
  for (const row of ranked) {
    if (seen.has(row.n.taxonomyId)) continue;
    seen.add(row.n.taxonomyId);
    out.push({
      taxonomyId: row.n.taxonomyId,
      categoryName: row.n.name,
      categoryPath: row.n.path,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function findFlattenedEtsyCategory(
  nodes: FlatEtsyCategory[],
  taxonomyId: number
): EtsyCategorySuggestion | null {
  const hit = nodes.find((n) => n.taxonomyId === taxonomyId);
  if (!hit) return null;
  return {
    taxonomyId: hit.taxonomyId,
    categoryName: hit.name,
    categoryPath: hit.path,
  };
}

export async function loadEtsyTaxonomyIndex(
  accessToken: string,
  connectionId?: string
): Promise<FlatEtsyCategory[]> {
  if (treeCache && Date.now() - treeCache.at < TREE_TTL_MS) {
    return treeCache.nodes;
  }
  if (connectionId) setEtsyConnectionContext(connectionId);
  const res = await etsyGet<{ results?: EtsyTaxonomyApiNode[] }>(
    accessToken,
    "/seller-taxonomy/nodes"
  );
  const nodes = flattenEtsyTaxonomyNodes(res.results ?? []);
  treeCache = { at: Date.now(), nodes };
  return nodes;
}

export async function searchEtsyCategories(
  accessToken: string,
  query: string,
  connectionId?: string
): Promise<EtsyCategorySuggestion[]> {
  const nodes = await loadEtsyTaxonomyIndex(accessToken, connectionId);
  return searchFlattenedEtsyCategories(nodes, query);
}

export async function lookupEtsyCategory(
  accessToken: string,
  taxonomyId: number,
  connectionId?: string
): Promise<EtsyCategorySuggestion | null> {
  const nodes = await loadEtsyTaxonomyIndex(accessToken, connectionId);
  return findFlattenedEtsyCategory(nodes, taxonomyId);
}

/** Test helper — drop cached seller taxonomy between cases. */
export function resetEtsyTaxonomyCache(): void {
  treeCache = null;
}
