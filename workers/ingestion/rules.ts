/**
 * Daybreak Rule Engine
 *
 * Deterministic event classification and market-moving scoring via regex.
 * Runs synchronously in <5ms — no API call, no network, pure computation.
 * All patterns are pre-compiled at module load time.
 *
 * Ported from daybreak_enrichment_pipeline_v2.md (rules.py spec).
 * Priority hierarchy: LLM Pass 2 > LLM Pass 1 > Rules/NLP
 * Rules run as Stage 0 and feed hints to downstream LLM stages.
 */

import type { EventType } from "./taxonomy";

// ─── Source tier mapping ─────────────────────────────────────────────────────
//
// Tier 1: institutional primary sources (wire services, official filings)
// Tier 2: major financial media
// Tier 3: everything else (default)

export const SOURCE_TIERS: Record<string, 1 | 2 | 3> = {
  "Reuters": 1,
  "Bloomberg": 1,
  "The Wall Street Journal": 1,
  "Financial Times": 1,
  "Associated Press": 1,
  "SEC EDGAR": 1,   // regulatory primary source — always high signal
  "NY Times": 2,
  "CNBC": 2,
  "Hunterbrook": 2,
};

export function getSourceTier(source: string): 1 | 2 | 3 {
  return SOURCE_TIERS[source] ?? 3;
}

// ─── Event type rules ────────────────────────────────────────────────────────

interface CompiledRule {
  event_type: EventType;
  patterns: RegExp[];
  confidence: "high" | "medium";
}

function compileRules(
  raw: Array<{ event_type: EventType; patterns: string[]; confidence: "high" | "medium" }>
): CompiledRule[] {
  return raw.map((r) => ({
    event_type: r.event_type,
    patterns: r.patterns.map((p) => new RegExp(p, "i")),
    confidence: r.confidence,
  }));
}

// Pre-compiled at module load — no per-call cost.
const EVENT_TYPE_RULES: CompiledRule[] = compileRules([
  {
    event_type: "earnings_release",
    confidence: "high",
    patterns: [
      "reports?\\s+Q[1-4]",
      "quarterly\\s+(results|earnings|profit|revenue)",
      "beats?\\s+(estimates|expectations|consensus)",
      "misses?\\s+(estimates|expectations|consensus)",
      "(EPS|earnings per share)\\s+(of|at|came in)",
      "(revenue|sales|net income)\\s+(rose|fell|increased|decreased|topped|missed)",
    ],
  },
  {
    event_type: "guidance_change",
    confidence: "high",
    patterns: [
      "(raises?|lowers?|cuts?|boosts?|narrows?)\\s+(guidance|outlook|forecast)",
      "(full[- ]year|FY\\d{2,4})\\s+(guidance|outlook)",
      "(reaffirms?|maintains?)\\s+(guidance|outlook)",
    ],
  },
  {
    event_type: "merger_announcement",
    confidence: "high",
    patterns: [
      "(acquires?|to acquire|acquisition of|to buy|buying|purchases?|to purchase)",
      "(merger|merging)\\s+(with|of|between)",
      "(deal|transaction)\\s+(valued|worth)\\s+\\$",
      "(takeover|buyout)\\s+(bid|offer|deal)",
    ],
  },
  {
    event_type: "acquisition_rumor",
    confidence: "medium",
    patterns: [
      "(in talks?|exploring|considers?|weighs?|mulls?)\\s+(to\\s+)?(acquire|buy|purchase|merger|deal)",
      "(acquisition|takeover|buyout)\\s+(target|talks?|rumor|speculation)",
    ],
  },
  {
    event_type: "executive_departure",
    confidence: "high",
    patterns: [
      "(CEO|CFO|CTO|COO|chief\\s+\\w+\\s+officer|president|chairman)\\s+(steps?\\s+down|resigns?|retires?|departs?|leaves?|exits?|ousted|fired|replaced)",
      "(steps?\\s+down|resigns?|retires?)\\s+as\\s+(CEO|CFO|CTO|COO|chief|president|chairman)",
    ],
  },
  {
    event_type: "executive_appointment",
    confidence: "high",
    patterns: [
      "(names?|appoints?|hires?|taps?|promotes?)\\s+\\w+\\s+(as\\s+)?(new\\s+)?(CEO|CFO|CTO|COO|chief|president|chairman)",
      "(new|incoming|named)\\s+(CEO|CFO|CTO|COO|chief\\s+\\w+\\s+officer|president|chairman)",
    ],
  },
  {
    event_type: "product_announcement",
    confidence: "medium",
    patterns: [
      "(launches?|unveils?|introduces?|announces?|reveals?)\\s+(new\\s+)?(product|service|platform|device|model|version|feature)",
    ],
  },
  {
    event_type: "regulatory_action",
    confidence: "high",
    patterns: [
      "(SEC|FTC|DOJ|FDA|FCC|CFPB|EPA)\\s+(probes?|investigates?|charges?|fines?|sues?|blocks?|approves?|clears?)",
      "(antitrust|regulatory|regulators?)\\s+(probe|investigation|review|scrutiny|action|approval|clearance)",
    ],
  },
  {
    event_type: "lawsuit_filed",
    confidence: "high",
    patterns: [
      "(files?\\s+suit|files?\\s+lawsuit|sues?|sued\\s+by|lawsuit\\s+against|legal\\s+action)",
      "(class[- ]action|patent\\s+infringement|antitrust\\s+suit)",
    ],
  },
  {
    event_type: "settlement",
    confidence: "high",
    patterns: [
      "(settles?|settlement)\\s+(for|of|with|worth|valued)",
      "(agrees?\\s+to\\s+pay|to settle)\\s+\\$",
    ],
  },
  {
    event_type: "capital_raise",
    confidence: "high",
    patterns: [
      "(raises?|raised|raising)\\s+\\$[\\d.]+\\s*(million|billion|M|B|mn|bn)",
      "(IPO|initial public offering|public offering|debt offering|bond (sale|offering|issuance))",
      "(Series\\s+[A-Z])\\s+(funding|round|raise)",
    ],
  },
  {
    event_type: "share_repurchase",
    confidence: "high",
    patterns: [
      "(buyback|share repurchase|stock repurchase)\\s+(program|plan|of\\s+\\$)",
      "(authorizes?|announces?|expands?)\\s+\\$[\\d.]+\\s*(million|billion|M|B|mn|bn)\\s+(buyback|repurchase)",
    ],
  },
  {
    event_type: "dividend_change",
    confidence: "high",
    patterns: [
      "(raises?|increases?|cuts?|suspends?|initiates?|declares?)\\s+(quarterly\\s+)?dividend",
      "(special|extra)\\s+dividend",
      "dividend\\s+(of|at)\\s+\\$[\\d.]+",
    ],
  },
  {
    event_type: "economic_release",
    confidence: "high",
    patterns: [
      "(CPI|PPI|GDP|nonfarm payrolls?|unemployment rate|jobless claims|retail sales|housing starts|PMI|ISM)\\s+(rose|fell|came in|at|above|below|beat|missed|unchanged)",
      "(inflation|consumer prices|producer prices)\\s+(rose|fell|accelerated|decelerated|slowed|cooled|heated)",
    ],
  },
  {
    event_type: "central_bank_commentary",
    confidence: "high",
    patterns: [
      "(Fed|Federal Reserve|ECB|BOJ|BOE|PBOC)\\s+(raises?|cuts?|holds?|pauses?|signals?|hikes?)",
      "(Powell|Lagarde|Ueda|Bailey)\\s+(says?|said|signals?|warns?|suggests?|indicates?)",
      "(rate\\s+decision|rate\\s+hike|rate\\s+cut|policy\\s+rate|benchmark\\s+rate)",
      "(FOMC|monetary policy)\\s+(statement|minutes|meeting|decision)",
    ],
  },
]);

// Pre-compiled market-signal patterns
const URGENCY_PATTERN = /\b(breaking|exclusive|halted|warns?|surges?|plunges?|plummets?|soars?|crashes?|spikes?)\b/i;
const DOLLAR_PATTERN = /\$[\d,.]+\s*(million|billion|M|B|mn|bn|trillion|T)?/i;

// Only the first RULES_BODY_LIMIT chars of body are scanned — signal density
// drops sharply past the lead paragraph, and this keeps latency bounded.
const RULES_BODY_LIMIT = 500;

// ─── Event type classification ───────────────────────────────────────────────

export interface EventTypeResult {
  event_type: EventType;
  event_type_confidence: "high" | "medium" | "low";
  matched_patterns: string[];
}

export function classifyEventType(headline: string, body: string): EventTypeResult {
  const text = headline + " " + body.slice(0, RULES_BODY_LIMIT);
  const matches: Array<{ event_type: EventType; confidence: "high" | "medium"; pattern: string }> = [];

  for (const rule of EVENT_TYPE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        matches.push({
          event_type: rule.event_type,
          confidence: rule.confidence,
          pattern: pattern.source,
        });
        break; // one match per rule is sufficient
      }
    }
  }

  if (matches.length === 0) {
    return { event_type: "none", event_type_confidence: "low", matched_patterns: [] };
  }

  // High-confidence match wins; if tied, first match wins
  const highConf = matches.filter((m) => m.confidence === "high");
  const best = highConf.length > 0 ? highConf[0] : matches[0];

  return {
    event_type: best.event_type,
    event_type_confidence: best.confidence,
    matched_patterns: matches.map((m) => m.pattern),
  };
}

// ─── Market-moving heuristic ─────────────────────────────────────────────────
//
// Note: ticker-based signals (mega-cap, S&P 500) are omitted here because
// entity extraction hasn't run yet at Stage 0. The rule engine contributes
// source tier + event type + headline urgency + dollar amounts.

const MARKET_MOVING_THRESHOLD = 4;

const SIGNAL_SCORES: Record<string, number> = {
  source_tier_1: 3,
  source_tier_2: 1,
  headline_urgency: 2,
  earnings_event: 2,
  executive_change_event: 2,
  ma_event: 3,
  regulatory_event: 2,
  capital_raise_event: 1,
  settlement_event: 1,
  contains_dollar_figure: 1,
};

const EVENT_SIGNAL_MAP: Partial<Record<EventType, string>> = {
  earnings_release: "earnings_event",
  guidance_change: "earnings_event",
  executive_departure: "executive_change_event",
  executive_appointment: "executive_change_event",
  merger_announcement: "ma_event",
  acquisition_rumor: "ma_event",
  regulatory_action: "regulatory_event",
  capital_raise: "capital_raise_event",
  settlement: "settlement_event",
};

export interface MarketMovingResult {
  market_moving_score: number;
  is_market_moving_candidate: boolean;
  market_moving_signals: string[];
}

export function scoreMarketMoving(
  headline: string,
  sourceTier: 1 | 2 | 3,
  eventType: EventType
): MarketMovingResult {
  let score = 0;
  const signals: string[] = [];

  if (sourceTier === 1) {
    score += SIGNAL_SCORES.source_tier_1;
    signals.push("source_tier_1");
  } else if (sourceTier === 2) {
    score += SIGNAL_SCORES.source_tier_2;
    signals.push("source_tier_2");
  }

  if (URGENCY_PATTERN.test(headline)) {
    score += SIGNAL_SCORES.headline_urgency;
    signals.push("headline_urgency");
  }

  const eventSignal = EVENT_SIGNAL_MAP[eventType];
  if (eventSignal) {
    score += SIGNAL_SCORES[eventSignal];
    signals.push(eventSignal);
  }

  if (DOLLAR_PATTERN.test(headline)) {
    score += SIGNAL_SCORES.contains_dollar_figure;
    signals.push("contains_dollar_figure");
  }

  return {
    market_moving_score: score,
    is_market_moving_candidate: score >= MARKET_MOVING_THRESHOLD,
    market_moving_signals: signals,
  };
}

// ─── Combined rule engine entry point ────────────────────────────────────────

export interface RulesResult extends EventTypeResult, MarketMovingResult {
  source_tier: 1 | 2 | 3;
}

export function runRuleEngine(headline: string, body: string, source: string): RulesResult {
  const tier = getSourceTier(source);
  const eventResult = classifyEventType(headline, body);
  const marketResult = scoreMarketMoving(headline, tier, eventResult.event_type);

  return {
    ...eventResult,
    ...marketResult,
    source_tier: tier,
  };
}
