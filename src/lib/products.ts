import data from "../data/products.json";

export interface Product {
  slug: string;
  name: string;
  category: string;
  price: number;
  fabricWeight: string | null;
  fit: string | null;
  printMethod: string | null;
  leadTimeDays: number | null;
  dispatch: string | null;
  stock: number;
  photo: string | null;
  sizes: string[];
  runSize?: number;
  runRemaining?: number;
}

export const products = data as Product[];

/**
 * The two-system rule, derived and never stored. A stored flag drifts out of
 * sync with reality, which is the failure the rule exists to prevent.
 *
 * Deliberately not `photo !== null`. An empty string, an undefined key or a
 * whitespace path are all falsy-in-spirit but pass a null check, and each one
 * would render a product dark over a placeholder — the one combination
 * CLAUDE.md forbids outright. Anything that is not a real path renders light.
 */
export const systemFor = (product: Product): "dark" | "light" =>
  typeof product.photo === "string" && product.photo.trim() !== "" ? "dark" : "light";

/** Integer KSh in the data, formatted only at the edge. */
export const price = (value: number): string => `KSh ${value.toLocaleString("en-KE")}`;
