/**
 * Synoptic WebSocket feed — real-time intel stream
 *
 * Connects to wss://api.synoptic.com/v1/ws/on-stream-post and pushes
 * incoming posts into the articles table as PENDING for pipeline processing.
 *
 * Requires SYNOPTIC_API_KEY env var. Skips gracefully if not set.
 * Auto-reconnects with exponential backoff on disconnect or error.
 *
 * Message envelope: { event: string, data: { id, text, json, ... } }
 * SEC filing text format:
 *   Filed file: <accession>
 *   CIK: <cik>
 *   Type: <form-type>
 *   Company Name: <name>
 *   Link: <url>
 */

import { createClient } from "@supabase/supabase-js";
import type { ArticleInsert } from "../../../lib/supabase/types";

const WS_URL = "wss://api.synoptic.com/v1/ws/on-stream-post";
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

// Mirror edgar.ts BLOCKED_FORM_TYPES — keep in sync
const BLOCKED_FORM_TYPES = new Set([
  "424B2", "424B3", "424B5",
  "FWP",
  "497", "497K",
  "485BPOS", "485APOS", "485BXT",
  "N-14", "N-14/A",
  "N-CEN", "N-CEN/A",
  "N-PORT", "N-PORT/A",
]);

interface SynopticEnvelope {
  event: string;
  data: {
    id?: string;
    text?: string;
    [key: string]: unknown;
  };
}

interface SecFiling {
  accession: string | null;
  formType: string | null;
  company: string | null;
  link: string | null;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Parse SEC EDGAR filing text block into structured fields. */
function parseSecFiling(text: string): SecFiling | null {
  // Must contain at least "Type:" to be treated as an SEC filing
  if (!text.includes("Type:")) return null;

  const lines = text.split("\n");
  const get = (prefix: string): string | null =>
    lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? null;

  return {
    accession: get("Filed file:"),
    formType: get("Type:"),
    company: get("Company Name:"),
    link: get("Link:"),
  };
}

async function handleEnvelope(envelope: SynopticEnvelope): Promise<void> {
  if (envelope.event !== "stream.post.created") return;

  const { id, text } = envelope.data;
  if (!text) return;

  // Try to parse as SEC filing first
  const filing = parseSecFiling(text);

  if (filing) {
    // Apply same block list as the EDGAR RSS poller
    if (filing.formType && BLOCKED_FORM_TYPES.has(filing.formType)) {
      console.log(`[synoptic] Skipping blocked form type: ${filing.formType}`);
      return;
    }

    const title =
      filing.company && filing.formType
        ? `${filing.formType} — ${filing.company}`
        : text.split("\n")[0].slice(0, 120);

    const url =
      filing.link ?? `https://synoptic.com/post/${id ?? Date.now()}`;

    await upsertArticle({ title, body: text, url });
    return;
  }

  // Generic post (news, alerts, etc.)
  const firstLine = text.split("\n")[0].trim();
  const title = firstLine.slice(0, 120) || "Synoptic post";
  const url = `https://synoptic.com/post/${id ?? Date.now()}`;

  await upsertArticle({ title, body: text, url });
}

async function upsertArticle({
  title,
  body,
  url,
}: {
  title: string;
  body: string;
  url: string;
}): Promise<void> {
  const row: ArticleInsert = {
    title: title.trim(),
    body: body.trim(),
    source: "Synoptic",
    author: null,
    url,
    published_at: null,
    status: "PENDING",
    is_breaking: false,
  };

  const supabase = getSupabase();
  const { error } = await supabase
    .from("articles")
    .upsert(row, { onConflict: "url", ignoreDuplicates: true });

  if (error) {
    console.error(`[synoptic] Insert error: ${error.message}`);
  } else {
    console.log(`[synoptic] +1: ${title.slice(0, 80)}`);
  }
}

function connect(apiKey: string, attempt = 0): void {
  const url = `${WS_URL}?apiKey=${apiKey}`;
  let ws: import("ws").WebSocket;

  try {
    import("ws").then(({ default: WebSocket }) => {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("[synoptic] WebSocket connected");
        attempt = 0;
      };

      ws.onmessage = async (event) => {
        try {
          const envelope: SynopticEnvelope =
            typeof event.data === "string"
              ? JSON.parse(event.data)
              : JSON.parse(event.data.toString());

          await handleEnvelope(envelope);
        } catch (err) {
          console.warn(
            `[synoptic] Failed to parse message: ${(err as Error).message}`
          );
        }
      };

      ws.onerror = (err) => {
        console.error(
          `[synoptic] WebSocket error: ${(err as ErrorEvent).message ?? "unknown"}`
        );
      };

      ws.onclose = () => {
        console.warn("[synoptic] WebSocket closed — reconnecting...");
        scheduleReconnect(apiKey, attempt + 1);
      };
    });
  } catch (err) {
    console.error(
      `[synoptic] Failed to create WebSocket: ${(err as Error).message}`
    );
    scheduleReconnect(apiKey, attempt + 1);
  }
}

function scheduleReconnect(apiKey: string, attempt: number): void {
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, Math.min(attempt, 6)),
    RECONNECT_MAX_MS
  );
  console.log(
    `[synoptic] Reconnecting in ${delay / 1000}s (attempt ${attempt})...`
  );
  setTimeout(() => connect(apiKey, attempt), delay);
}

export function startSynopticFeed(): void {
  const apiKey = process.env.SYNOPTIC_API_KEY;
  if (!apiKey) {
    return;
  }
  console.log("[synoptic] Starting WebSocket feed...");
  connect(apiKey);
}
