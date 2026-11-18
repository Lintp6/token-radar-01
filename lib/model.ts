// Token Radar's model, version radar-2.
//
// One sealed snapshot in, one ranked board out. The board ranks every protocol the snapshot
// records no token for, minus the products whose token already trades in another form: exchanges,
// bridges, wrapped and staked products, and versioned pools of another protocol. The snapshot's
// own watchlist is the floor: all 40 of its slugs are always on the board, and the rest of the
// board is every other protocol that passes the same rule, however small its TVL.
//
// Implied value is one function of the snapshot's own figures, the same for every row:
//
//   category multiple = median mcap / TVL of the live-token protocols in the same category,
//                         each ratio winsorized to 2.0; categories with fewer than 5 live
//                         samples fall back to the overall median of all live ratios
//   relative growth   = clamp(change_7d - market median 7d change, -40, +60) per cent
//   growth multiplier = 1 + relative growth / 100 x 0.8
//   maturity          = 0.55 + min(age_days, 1095) / 1095 x 0.45   (age unknown: 365 days)
//   youth haircut     = 0.85 when the protocol is under 180 days old, else 1.0
//   implied           = round(TVL x category multiple x growth multiplier x maturity x haircut)
//
// The market median and every multiple are computed from this snapshot at run time, never
// written in by hand. No protocol name is ever special-cased.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunables, as the dashboard states them and its sandbox may move them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  youth_cutoff_days: number;
  youth_haircut: number;
  min_category_samples: number;
  winsorize_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.8,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  youth_cutoff_days: 180,
  youth_haircut: 0.85,
  min_category_samples: 5,
  winsorize_cap: 2.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category: string | null;
    category_multiple: number;
    category_samples: number;
    relative_growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    youth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One board row in the dashboard's compact form. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_samples: number;
  relative_growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  youth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable multiple, with its sample count, for the model panel. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
  fallback: boolean;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  market_median_change_7d: number;
  fallback_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  pre_token_total: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers; NaN when the list is empty. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole-day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Categories whose products are not candidates for a first token: exchanges and the wrapped, bridged and staked products of tokens that already trade. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A name ending in a release marker (V2, v3, 2.0): a versioned pool of another protocol. */
const VERSIONED_NAME = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(?:wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)(?:\s|$)/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol may be ranked: it records no token, is not an exchange or a wrapped,
 * bridged or staked product, and is not a versioned pool. The snapshot's watchlist rule, applied
 * to every protocol, so the watchlist itself always passes.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The live-token protocols' mcap / TVL ratios, winsorized, grouped by category. */
export interface ComparableSet {
  /** The fallback multiple: the median of every live ratio, winsorized. */
  fallback: number;
  /** Per-category multiples for categories with enough live samples. */
  byCategory: Map<string, { multiple: number; samples: number }>;
  /** The market's median seven-day change, the zero line for relative growth. */
  marketMedianChange: number;
}

export function comparables(snapshot: Snapshot, model: ModelConstants): ComparableSet {
  // A market cap of zero is not a comparable: it is a dead token, not a priced one. Fifteen
  // protocols in the snapshot record mcap_usd 0; leaving them in would drag every multiple down
  // with ratios of exactly zero. A recorded nonzero market cap counts, even when the record is
  // odd: one protocol records a tiny negative cap, and its ratio sits at the bottom of the list.
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd !== 0 && p.tvl_usd > 0);
  const ratio = (p: SnapshotProtocol): number => Math.min((p.mcap_usd as number) / p.tvl_usd, model.winsorize_cap);
  const fallback = median(live.map(ratio));
  const byCategory = new Map<string, { multiple: number; samples: number }>();
  const grouped = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [p]);
    else list.push(p);
  }
  for (const [category, list] of grouped) {
    if (list.length >= model.min_category_samples) {
      byCategory.set(category, { multiple: median(list.map(ratio)), samples: list.length });
    }
  }
  const changes = snapshot.protocols.map((p) => p.change_7d).filter((c): c is number => c !== null && Number.isFinite(c));
  return { fallback, byCategory, marketMedianChange: median(changes) };
}

/** The score of one protocol under the model: its implied value and every multiplier behind it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  set: ComparableSet,
): {
  implied: number;
  categoryMultiple: number;
  categorySamples: number;
  relativeGrowth: number;
  growthMult: number;
  maturityMult: number;
  youthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const entry = protocol.category !== null ? set.byCategory.get(protocol.category) : undefined;
  const categoryMultiple = entry === undefined ? set.fallback : entry.multiple;
  const categorySamples = entry === undefined ? 0 : entry.samples;
  const rawGrowth = finite(protocol.change_7d, 0);
  const relativeGrowth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth - set.marketMedianChange));
  const growthMult = 1 + (relativeGrowth / 100) * model.growth_weight;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const youthMult = ageForModel < model.youth_cutoff_days ? model.youth_haircut : 1;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult * youthMult));
  return { implied, categoryMultiple, categorySamples, relativeGrowth, growthMult, maturityMult, youthMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const set = comparables(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries
  // (it cannot, but coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other protocol that passes the same rule, however small its TVL.
  // No cap, no TVL order: the board is the whole rankable set, not a top-N slice of it.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, model, set);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category: s.p.category,
      category_multiple: round4(s.categoryMultiple),
      category_samples: s.categorySamples,
      relative_growth_pct: round2(s.relativeGrowth),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      youth_multiplier: s.youthMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Chains where a transaction costs about a dollar or two, rather than mainnet prices. */
const CHEAP_CHAINS = new Set([
  'Base',
  'Arbitrum',
  'Optimism',
  'Solana',
  'Polygon',
  'Binance',
  'Avalanche',
  'zkSync Era',
  'Linea',
  'Scroll',
  'Blast',
  'Mantle',
  'Mode',
  'Sonic',
  'Berachain',
  'Hyperliquid L1',
  'Unichain',
  'Ink',
  'Katana',
  'Plasma',
  'Stable',
  'Arc',
  'Tempo',
  'Monad',
  'Corn',
  'BOB',
  'Sui',
  'Aptos',
  'Sei',
  'Starknet',
  'TON',
  'Tron',
]);

/** What one transaction on the protocol's first chain costs, in the page's own words. */
function gasFor(p: SnapshotProtocol): string {
  const chain = chainOf(p);
  if (chain === 'Ethereum') return '$4-$8 of gas';
  if (CHEAP_CHAINS.has(chain)) return '$1-$2 of gas';
  return '$2-$4 of gas';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open, then borrow about 30% of the supplied value to show both sides of the book.`;
  if (c.includes('cdp') || c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain} against USDC collateral and keep the position above a 200% collateral ratio.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in its highest-fee tier and keep the position in range.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares for the full season.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it; the mint itself is the on-chain footprint.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares; curator vaults reward sticky deposits, not churn.`;
  if (c.includes('restak')) return `Restake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge; close it only after the weekly snapshot.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one market position each week; a resolved position counts more than an open one.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${chain} through its canonical bridge and use ${name}'s app at least once a week.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the season.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position through at least one funding cycle.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the season.`;
}

/** The category's weekly qualifying action. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('collateral')) return 'Make one qualifying action each week: a new deposit, a borrow, a repayment, or a vote on a governance proposal.';
  if (c.includes('cdp') || c.includes('stable')) return 'Make one qualifying action each week: mint, repay, or adjust the collateral ratio of the position.';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'Make one qualifying action each week: a swap through the pool, a liquidity adjustment, or a fee claim.';
  if (c.includes('yield')) return 'Make one qualifying action each week: a new deposit, a harvest, or a restake of the vault rewards.';
  if (c.includes('rwa')) return 'Make one qualifying action each week: a new mint, a transfer of the yield asset, or a claim of the accrued yield.';
  if (c.includes('curator') || c.includes('allocator')) return 'Make one qualifying action each week: a new deposit into a vault, or a vote on the curator allocation.';
  if (c.includes('restak')) return 'Make one qualifying action each week: a new restake, or a claim of the restaking rewards.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Make one qualifying action each week: open or close one small position, or claim the trading rewards.';
  if (c.includes('prediction')) return 'Make one qualifying action each week: place one new market position and let an earlier one resolve.';
  if (c.includes('chain')) return 'Make one qualifying action each week: use the chain app once, such as a swap, a transfer, or a contract call.';
  if (c.includes('insurance')) return 'Make one qualifying action each week: renew or top up the cover, or vote on a claim assessment.';
  if (c.includes('basis')) return 'Make one qualifying action each week: a new deposit, or a claim of the basis yield.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Nothing here claims the protocol has no token: the snapshot only records that none is
 * listed for it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline, away from the wallet you use every day.`,
      cost: `under $3 of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: `about ${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; a link sent to you is not the protocol's.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_samples: row.model.category_samples,
    relative_growth_pct: row.model.relative_growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    youth_multiplier: row.model.youth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const set = comparables(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const multiples: CategoryMultiple[] = [...set.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: round4(v.multiple), samples: v.samples, fallback: false }))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  // The dashboard's rows carry the multipliers at full precision, so the page can recompute a
  // row from the snapshot figures and check the number board.json carries; the board itself
  // stores the same multipliers rounded for display.
  const index = bySlug(snapshot.protocols);
  const rows: RadarRow[] = board.map((r) => {
    const p = index.get(r.slug)!;
    const s = impliedValue(p, snapshot.as_of, model, set);
    return {
      ...radarRow(r),
      category_multiple: s.categoryMultiple,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      youth_multiplier: s.youthMult,
      relative_growth_pct: s.relativeGrowth,
    };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    // Full precision here, like the multipliers: the page recomputes rows from this figure, and
    // a rounded median would move the growth multiplier enough to break the check.
    market_median_change_7d: set.marketMedianChange,
    fallback_multiple: round4(set.fallback),
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    pre_token_total: snapshot.protocols.filter(isPreToken).length,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
