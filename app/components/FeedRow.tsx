import type { ArticleWithEntities } from "@/lib/supabase/types";

const SOURCE_ABBREV: Record<string, string> = {
  Reuters: "RTRS",
  Bloomberg: "BBG",
  "SEC EDGAR": "SEC",
  "The Wall Street Journal": "WSJ",
  "Financial Times": "FT",
  CNBC: "CNBC",
  "Seeking Alpha": "SA",
  "Yahoo Finance": "YFN",
  MarketWatch: "MKW",
};

function abbreviateSource(source: string): string {
  return SOURCE_ABBREV[source] ?? source.slice(0, 4).toUpperCase();
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22C55E";
  if (score >= 65) return "#4ADE80";
  if (score >= 50) return "#86EFAC";
  if (score >= 35) return "var(--neutral)";
  return "var(--text-muted)";
}

interface Props {
  article: ArticleWithEntities;
  isNew: boolean;
  isSelected: boolean;
  onClick: () => void;
}

export default function FeedRow({ article, isNew, isSelected, onClick }: Props) {
  const stripeColor = article.is_breaking ? "var(--breaking)" : "var(--accent-dim)";

  let rowBg = "transparent";
  if (isSelected) rowBg = "var(--surface-raised)";
  else if (article.is_breaking) rowBg = "rgba(245,158,11,0.04)";

  // Top 2 tickers by absolute score
  const topTickers = (article.entities ?? [])
    .filter((e) => e.ticker)
    .slice(0, 2)
    .map((e) => e.ticker!);

  return (
    <div
      className="feed-row"
      onClick={onClick}
      style={{
        display: "flex",
        height: "38px",
        alignItems: "center",
        borderBottom: "1px solid var(--border)",
        backgroundColor: rowBg,
        animation: isNew ? "slideIn 150ms ease-out" : undefined,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {/* Urgency stripe */}
      <div
        style={{
          width: "3px",
          alignSelf: "stretch",
          backgroundColor: stripeColor,
          flexShrink: 0,
        }}
      />

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          overflow: "hidden",
          gap: 0,
        }}
      >
        {/* Flags — BRKG only (44px) */}
        <div
          style={{
            width: "44px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          {article.is_breaking && (
            <span
              style={{
                fontSize: "9px",
                fontFamily: "var(--font-geist-mono)",
                fontWeight: 500,
                color: "var(--breaking)",
                backgroundColor: "var(--breaking-bg)",
                padding: "1px 4px",
                borderRadius: "2px",
                letterSpacing: "0.03em",
              }}
            >
              BRKG
            </span>
          )}
        </div>

        {/* Timestamp (88px) */}
        <div
          style={{
            width: "88px",
            flexShrink: 0,
            fontSize: "11px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatTimestamp(article.published_at ?? article.created_at)}
        </div>

        {/* Source (44px) */}
        <div
          style={{
            width: "44px",
            flexShrink: 0,
            fontSize: "11px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {abbreviateSource(article.source)}
        </div>

        {/* Tickers (96px) — entity tickers from pipeline */}
        <div
          style={{
            width: "96px",
            flexShrink: 0,
            display: "flex",
            gap: "6px",
            alignItems: "center",
            overflow: "hidden",
          }}
        >
          {topTickers.map((ticker) => (
            <span
              key={ticker}
              style={{
                fontFamily: "var(--font-geist-mono)",
                fontWeight: 500,
                fontSize: "11px",
                color: "var(--accent)",
                whiteSpace: "nowrap",
              }}
            >
              {ticker}
            </span>
          ))}
        </div>

        {/* Headline (flex-1) */}
        <div
          style={{
            flex: 1,
            fontSize: "13px",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {article.title}
        </div>

        {/* Score (56px) */}
        <div
          style={{
            width: "56px",
            flexShrink: 0,
            fontSize: "12px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text-muted)",
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {article.importance_score != null ? (
            <span style={{ color: scoreColor(article.importance_score) }}>
              {article.importance_score}
            </span>
          ) : (
            <span style={{ color: "var(--text-muted)", opacity: 0.4 }}>—</span>
          )}
        </div>
      </div>
    </div>
  );
}
