"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Article, ArticleWithEntities, EntityTag } from "@/lib/supabase/types";
import FeedRow from "./FeedRow";
import DetailPanel from "./DetailPanel";

interface Props {
  initialArticles: ArticleWithEntities[];
}

export default function WireFeed({ initialArticles }: Props) {
  const [articles, setArticles] = useState<ArticleWithEntities[]>(initialArticles);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"wire" | "curated">("wire");

  const byTime = (a: ArticleWithEntities, b: ArticleWithEntities) =>
    new Date(b.published_at ?? b.created_at).getTime() -
    new Date(a.published_at ?? a.created_at).getTime();

  const visibleArticles =
    tab === "curated"
      ? [...articles]
          .filter((a) => a.importance_score != null && a.status !== "SCREENED_OUT")
          .sort(byTime)
      : [...articles].sort(byTime);

  useEffect(() => {
    const supabase = createClient();

    async function fetchEntities(articleId: string): Promise<EntityTag[]> {
      const { data } = await supabase
        .from("entity_impacts")
        .select("score, entities(name, ticker)")
        .eq("article_id", articleId) as unknown as {
          data: Array<{ score: number; entities: { name: string; ticker: string | null } | null }> | null;
        };
      return (data ?? [])
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, 3)
        .map((i) => ({
          name: i.entities?.name ?? "",
          ticker: i.entities?.ticker ?? null,
          score: i.score,
        }));
    }

    const channel = supabase
      .channel("wire-feed")
      // New articles slide in at top
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "articles" },
        (payload) => {
          const article = payload.new as Article;
          setArticles((prev) => [{ ...article, entities: [] }, ...prev]);
          setNewIds((prev) => new Set(prev).add(article.id));
          setTimeout(() => {
            setNewIds((prev) => {
              const next = new Set(prev);
              next.delete(article.id);
              return next;
            });
          }, 300);
        }
      )
      // Enrichment updates (score, category, is_breaking, importance_score)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "articles" },
        async (payload) => {
          const updated = payload.new as Article;
          const entities = await fetchEntities(updated.id);
          setArticles((prev) =>
            prev.map((a) =>
              a.id === updated.id ? { ...updated, entities } : a
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Keyboard navigation: j/k to move up/down, Escape to deselect
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (visibleArticles.length === 0) return;
      if (e.key === "j") {
        setSelectedId((prev) => {
          const idx = prev ? visibleArticles.findIndex((a) => a.id === prev) : -1;
          return visibleArticles[Math.min(idx + 1, visibleArticles.length - 1)].id;
        });
      } else if (e.key === "k") {
        setSelectedId((prev) => {
          const idx = prev ? visibleArticles.findIndex((a) => a.id === prev) : visibleArticles.length;
          return visibleArticles[Math.max(idx - 1, 0)].id;
        });
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    },
    [visibleArticles]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const selectedArticle = selectedId
    ? articles.find((a) => a.id === selectedId) ?? null
    : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--bg)",
        display: "flex",
        flexDirection: "row",
      }}
    >
    {/* Feed column */}
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
      {/* Feed header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          backgroundColor: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          padding: "0 16px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <button
          onClick={() => setTab("curated")}
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: tab === "curated" ? "var(--accent)" : "var(--text-muted)",
            background: "none",
            border: "none",
            borderBottom: tab === "curated" ? "2px solid var(--accent)" : "2px solid transparent",
            padding: "0 8px",
            height: "36px",
            cursor: "pointer",
          }}
        >
          Curated
        </button>
        <button
          onClick={() => setTab("wire")}
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: tab === "wire" ? "var(--accent)" : "var(--text-muted)",
            background: "none",
            border: "none",
            borderBottom: tab === "wire" ? "2px solid var(--accent)" : "2px solid transparent",
            padding: "0 8px",
            height: "36px",
            cursor: "pointer",
          }}
        >
          Wire
        </button>

        <div style={{ flex: 1 }} />

        <span
          style={{
            fontSize: "10px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {visibleArticles.length} articles
        </span>

        <span
          style={{
            fontSize: "10px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text-muted)",
            marginLeft: "16px",
          }}
        >
          J/K navigate
        </span>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "26px",
          padding: "0 12px 0 15px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--surface)",
          position: "sticky",
          top: "36px",
          zIndex: 9,
        }}
      >
        <div style={colHeaderStyle(44)}>Flags</div>
        <div style={colHeaderStyle(88)}>Time</div>
        <div style={colHeaderStyle(44)}>Src</div>
        <div style={colHeaderStyle(96)}>Tickers</div>
        <div style={{ ...colHeaderStyle(0), flex: 1 }}>Headline</div>
        <div style={{ ...colHeaderStyle(56), textAlign: "right" }}>Score</div>
      </div>

      {/* Rows */}
      <div>
        {articles.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "200px",
              fontSize: "13px",
              color: "var(--text-muted)",
            }}
          >
            Waiting for articles...
          </div>
        ) : (
          visibleArticles.map((article) => (
            <FeedRow
              key={article.id}
              article={article}
              isNew={newIds.has(article.id)}
              isSelected={selectedId === article.id}
              onClick={() =>
                setSelectedId((prev) =>
                  prev === article.id ? null : article.id
                )
              }
            />
          ))
        )}
      </div>
    </div>
    {/* Detail panel */}
    {selectedArticle && (
      <DetailPanel
        article={selectedArticle}
        onClose={() => setSelectedId(null)}
      />
    )}
  </div>
  );
}

function colHeaderStyle(width: number): React.CSSProperties {
  return {
    width: width > 0 ? `${width}px` : undefined,
    flexShrink: 0,
    fontSize: "10px",
    fontFamily: "var(--font-geist-mono)",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
}
