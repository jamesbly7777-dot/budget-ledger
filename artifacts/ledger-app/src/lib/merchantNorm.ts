// Merchant alias normalization — canonical name mapping for duplicate detection and bill matching

const MERCHANT_ALIASES: [RegExp, string][] = [
  // Fuel / Gas Stations
  [/\boncue\b/i, "oncue"],
  [/\bqt\b|\bquiktrip\b/i, "quiktrip"],
  [/\bpapa.?s trading\b/i, "papas trading"],
  [/\bquick trip\b/i, "quiktrip"],
  [/\bcircle k\b/i, "circle k"],
  [/\bvalero\b/i, "valero"],
  [/\bshell\b/i, "shell"],
  [/\bchevrон|chevron\b/i, "chevron"],
  [/\bmurphy\b/i, "murphy"],

  // Bills / Debt
  [/\boklahoma mot(or)?\b/i, "oklahoma motor"],
  [/\bflex financ(e|ing)?\b|\bgetflex\b|\bflex loan\b/i, "flex finance"],
  [/\baffirm( inc| pay|ment)?\b/i, "affirm"],
  [/\bcox( comm(unications?)?)?\b/i, "cox"],
  [/\bcarecredit\b|\bsynchrony\b/i, "synchrony"],
  [/\bwells fargo( auto)?\b/i, "wells fargo"],
  [/\bplanet fitness\b/i, "planet fitness"],
  [/\bpikepass\b|\bpiketoll\b/i, "pikepass"],

  // Amazon variants
  [/\bamazon prime\b|\bprime video\b|\bamazon digital\b|\bamzn\b/i, "amazon"],

  // AI / Work tools
  [/\bopenai\b|\bchatgpt\b/i, "openai"],
  [/\bsaner( ai)?\b/i, "saner ai"],

  // Food / Restaurants
  [/\bchick.?fil.?a\b/i, "chick-fil-a"],
  [/\bwhataburger\b/i, "whataburger"],
  [/\bmcdonalds?\b|mcdonald.?s\b/i, "mcdonalds"],

  // Grocery
  [/\bwal.?mart\b/i, "walmart"],
  [/\bkroger\b/i, "kroger"],
  [/\baldi\b/i, "aldi"],
];

export function normalizeMerchant(name: string): string {
  const lower = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [regex, normalized] of MERCHANT_ALIASES) {
    if (regex.test(lower)) return normalized;
  }

  // Fallback: first 3 meaningful words (length > 2)
  return lower
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join(" ");
}

export function merchantsMatch(a: string, b: string): boolean {
  return normalizeMerchant(a) === normalizeMerchant(b);
}
