"use client";

import { useState, useEffect } from "react";

type SidebarState = "full" | "rail";

const WIDTHS: Record<SidebarState, number> = { full: 200, rail: 40 };

function IconChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9,2 4,7 9,12" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5,2 10,7 5,12" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="7,1.5 8.8,5.2 13,5.7 10,8.6 10.8,12.8 7,10.8 3.2,12.8 4,8.6 1,5.7 5.2,5.2" />
    </svg>
  );
}

function IconKeyboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3.5" width="12" height="7" rx="1" />
      <line x1="3.5" y1="6" x2="3.5" y2="6.1" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="6" y1="6" x2="6" y2="6.1" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="8.5" y1="6" x2="8.5" y2="6.1" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="4.5" y1="8.5" x2="9.5" y2="8.5" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

const SHORTCUTS = [
  { keys: "J / K", label: "Navigate" },
  { keys: "↵", label: "Open" },
  { keys: "Esc", label: "Close" },
];

export default function Sidebar() {
  const [state, setState] = useState<SidebarState>("full");

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-state") as SidebarState | null;
    if (saved) setState(saved);
  }, []);

  function cycle() {
    setState((prev) => {
      const next = prev === "full" ? "rail" : "full";
      localStorage.setItem("sidebar-state", next);
      return next;
    });
  }

  const width = WIDTHS[state];
  const isFull = state === "full";

  return (
    <div
      style={{
        width,
        minWidth: width,
        flexShrink: 0,
        overflow: "hidden",
        transition: "width 150ms ease-in-out, min-width 150ms ease-in-out",
        backgroundColor: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toggle button */}
      <button
        onClick={cycle}
        title={isFull ? "Collapse sidebar" : "Expand sidebar"}
        style={{
          height: "36px",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: isFull ? "flex-end" : "center",
          padding: isFull ? "0 12px" : "0",
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--border)",
          cursor: "pointer",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        {isFull ? <IconChevronLeft /> : <IconChevronRight />}
      </button>

      <div style={{ flex: 1, overflowY: isFull ? "auto" : "hidden", overflowX: "hidden" }}>
        {/* Watchlist */}
        <div style={{ padding: isFull ? "12px 12px 4px" : "8px 0 4px" }}>
          {isFull ? (
            <div
              style={{
                fontSize: "10px",
                fontFamily: "var(--font-geist-mono)",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "8px",
              }}
            >
              Watchlist
            </div>
          ) : (
            <div className="sidebar-icon" data-tooltip="Watchlist">
              <IconStar />
            </div>
          )}

          {isFull && (
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-muted)",
                fontStyle: "italic",
                padding: "4px 0",
              }}
            >
              No tickers added
            </div>
          )}
        </div>

        <div
          style={{
            height: "1px",
            backgroundColor: "var(--border)",
            margin: isFull ? "8px 0" : "8px 8px",
          }}
        />

        {/* Keyboard shortcuts */}
        <div style={{ padding: isFull ? "4px 12px 12px" : "4px 0 8px" }}>
          {isFull ? (
            <>
              <div
                style={{
                  fontSize: "10px",
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "8px",
                }}
              >
                Shortcuts
              </div>
              {SHORTCUTS.map(({ keys, label }) => (
                <div
                  key={keys}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "3px 0",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontFamily: "var(--font-geist-mono)",
                      color: "var(--text-muted)",
                      backgroundColor: "var(--surface-raised)",
                      padding: "1px 5px",
                      borderRadius: "2px",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {keys}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {label}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div className="sidebar-icon" data-tooltip="Shortcuts">
              <IconKeyboard />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
