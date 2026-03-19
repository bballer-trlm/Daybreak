"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ArticleWithEntities } from "@/lib/supabase/types";

interface EntityImpactDetail {
  name: string;
  ticker: string | null;
  type: string;
  score: number;
  time_horizon: string | null;
  impact_directness: string | null;
  analysis_text: string | null;
}

interface EnrichmentRow {
  stage_type: string;
  data: Record<string, unknown>;
}

interface Props {
  article: ArticleWithEntities;
  onClose: () => void;
}

const HORIZONS: Record<string, string> = {
  immediate: "IMM",
  short_term: "ST",
  medium_term: "MT",
  long_term: "LT",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(Math.abs(score), 100);
  const color = score >= 0 ? "var(--bullish)" : "var(--bearish)";
  const bg = score >= 0 ? "var(--bullish-bg)" : "var(--bearish-bg)";
  const sign = score >= 0 ? "+" : "";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          width: "80px",
          height: "4px",
          backgroundColor: "var(--surface-raised)",
          borderRadius: "2px",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            backgroundColor: color,
            borderRadius: "2px",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: "11px",
          fontWeight: 500,
          color,
          backgroundColor: bg,
          padding: "1px 5px",
          borderRadius: "2px",
          flexShrink: 0,
        }}
      >
        {sign}{score}
      </span>
    </div>
  );
}

function PipelineStrip({
  enrichments,
  status,
  entities,
  importanceScore,
}: {
  enrichments: EnrichmentRow[];
  status: string;
  entities: EntityImpactDetail[];
  importanceScore: number | null;
}) {
  const map = Object.fromEntries(enrichments.map((e) => [e.stage_type, e.data]));
  const inProgress = status === "PROCESSING" || status === "ENRICHING";

  function stageIcon(stage: string): string {
    if (!map[stage]) return inProgress ? "⟳" : "·";
    if (map[stage].failed) return "✗";
    return "✓";
  }

  function stageColor(stage: string): string {
    if (!map[stage]) return "var(--text-muted)";
    if (map[stage].failed) return "var(--bearish)";
    return "var(--bullish)";
  }

  const topTickers = entities
    .filter((e) => e.ticker)
    .slice(0, 3)
    .map((e) => e.ticker!);

  const segments: React.ReactNode[] = [];

  // Screener
  segments.push(
    <span key="screener" style={{ color: stageColor("screener") }}>
      {stageIcon("screener")} Screener
    </span>
  );

  // Classifier
  segments.push(
    <span key="sep1" style={{ color: "var(--text-muted)" }}> · </span>
  );
  segments.push(
    <span key="classifier" style={{ color: stageColor("classifier") }}>
      {stageIcon("classifier")} Classifier
    </span>
  );

  // Entities + tickers
  segments.push(
    <span key="sep2" style={{ color: "var(--text-muted)" }}> · </span>
  );
  segments.push(
    <span key="entities" style={{ color: stageColor("entities") }}>
      {stageIcon("entities")} Entities
      {topTickers.length > 0 && (
        <span style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)" }}>
          {" "}{topTickers.join(" ")}
        </span>
      )}
    </span>
  );

  // Score
  segments.push(
    <span key="sep3" style={{ color: "var(--text-muted)" }}> · </span>
  );
  if (importanceScore != null) {
    segments.push(
      <span
        key="score"
        style={{
          color: importanceScore >= 65 ? "var(--bullish)" : "var(--text-secondary)",
          fontFamily: "var(--font-geist-mono)",
        }}
      >
        {importanceScore}
      </span>
    );
  } else {
    segments.push(
      <span key="score" style={{ color: stageColor("scores") }}>
        {stageIcon("scores")} Score
      </span>
    );
  }

  return (
    <div
      style={{
        fontSize: "10px",
        fontFamily: "var(--font-geist-mono)",
        color: "var(--text-secondary)",
        padding: "6px 0",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        flexWrap: "wrap",
        gap: 0,
      }}
    >
      {segments}
    </div>
  );
}

export default function DetailPanel({ article, onClose }: Props) {
  const [enrichments, setEnrichments] = useState<EnrichmentRow[]>([]);
  const [impacts, setImpacts] = useState<EntityImpactDetail[]>([]);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase
        .from("article_enrichments")
        .select("stage_type, data")
        .eq("article_id", article.id),
      supabase
        .from("entity_impacts")
        .select("score, time_horizon, impact_directness, analysis_text, entities(name, ticker, type)")
        .eq("article_id", article.id),
    ]).then(([enrichRes, impactRes]) => {
      setEnrichments((enrichRes.data ?? []) as EnrichmentRow[]);
      const raw = (impactRes.data ?? []) as Array<{
        score: number;
        time_horizon: string | null;
        impact_directness: string | null;
        analysis_text: string | null;
        entities: { name: string; ticker: string | null; type: string } | null;
      }>;
      setImpacts(
        raw
          .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
          .map((i) => ({
            name: i.entities?.name ?? "",
            ticker: i.entities?.ticker ?? null,
            type: i.entities?.type ?? "company",
            score: i.score,
            time_horizon: i.time_horizon,
            impact_directness: i.impact_directness,
            analysis_text: i.analysis_text,
          }))
      );
    });
  }, [article.id]);

  const ts = article.published_at ?? article.created_at;

  return (
    <div
      style={{
        width: "340px",
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        backgroundColor: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        animation: "panelSlideIn 200ms ease-out",
        overflowY: "auto",
        position: "sticky",
        top: 0,
        maxHeight: "100vh",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          height: "36px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {article.category ?? "Article"}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "16px",
            lineHeight: 1,
            padding: "4px",
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: "16px 16px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Headline */}
        <div>
          <h2
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {article.title}
          </h2>
          <div
            style={{
              marginTop: "6px",
              display: "flex",
              gap: "12px",
              fontSize: "11px",
              fontFamily: "var(--font-geist-mono)",
              color: "var(--text-muted)",
            }}
          >
            <span>{formatDate(ts)}</span>
            <span>{formatTime(ts)}</span>
            <span>{article.source}</span>
            {article.url && (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                ↗
              </a>
            )}
          </div>
        </div>

        {/* Pipeline strip */}
        <PipelineStrip
          enrichments={enrichments}
          status={article.status}
          entities={impacts}
          importanceScore={article.importance_score}
        />

        {/* Entity impacts */}
        {impacts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div
              style={{
                fontSize: "10px",
                fontFamily: "var(--font-geist-mono)",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Entity Impacts
            </div>
            {impacts.map((entity, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {entity.ticker ? (
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono)",
                        fontWeight: 500,
                        fontSize: "12px",
                        color: "var(--accent)",
                      }}
                    >
                      {entity.ticker}
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontSize: "12px",
                      color: entity.ticker ? "var(--text-secondary)" : "var(--text-primary)",
                    }}
                  >
                    {entity.name}
                  </span>
                  {entity.time_horizon && (
                    <span
                      style={{
                        fontSize: "9px",
                        fontFamily: "var(--font-geist-mono)",
                        color: "var(--text-muted)",
                        marginLeft: "auto",
                      }}
                    >
                      {HORIZONS[entity.time_horizon] ?? entity.time_horizon}
                    </span>
                  )}
                </div>
                <ScoreBar score={entity.score} />
                {entity.analysis_text && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      lineHeight: 1.4,
                    }}
                  >
                    {entity.analysis_text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Body text */}
        {article.body && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div
              style={{
                fontSize: "10px",
                fontFamily: "var(--font-geist-mono)",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Summary
            </div>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {article.body.slice(0, 600)}
              {article.body.length > 600 && "…"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
