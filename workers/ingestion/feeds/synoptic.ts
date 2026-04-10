/**
 * Synoptic WebSocket feed — real-time intel stream
 *
 * Connects to wss://api.synoptic.com/v1/ws/on-stream-post and pushes
 * incoming posts into the articles table as PENDING for pipeline processing.
 *
 * Requires SYNOPTIC_API_KEY env var. Skips gracefully if not set.
 * Auto-reconnects with exponential backoff on disconnect or error.
 */

import { createClient } from "@supabase/supabase-js";
import type { ArticleInsert } from "../../../lib/supabase/types";

const WS_URL = "wss://api.synoptic.com/v1/ws/on-stream-post";
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

interface SynopticPost {
  id?: string;
  title?: string;
  content?: string;
  body?: string;
  text?: string;
  url?: string;
  link?: string;
  author?: string;
  published_at?: string;
  created_at?: string;
  timestamp?: string;
  source?: string;
  [key: string]: unknown;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function insertPost(post: SynopticPost): Promise<void> {
  const title =
    post.title ??
    post.content?.slice(0, 120) ??
    post.text?.slice(0, 120) ??
    "Synoptic post";

  const body = post.content ?? post.body ?? post.text ?? null;
  const url =
    post.url ??
    post.link ??
    `https://synoptic.com/post/${post.id ?? Date.now()}`;

  const publishedAt =
    post.published_at ?? post.created_at ?? post.timestamp ?? null;

  const row: ArticleInsert = {
    title: title.trim(),
    body: body?.trim() ?? null,
    source: "Synoptic",
    author: post.author ?? null,
    url,
    published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
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
    console.log(`[synoptic] +1 post: ${title.slice(0, 80)}`);
  }
}

function connect(apiKey: string, attempt = 0): void {
  const url = `${WS_URL}?apiKey=${apiKey}`;
  let ws: import("ws").WebSocket;

  try {
    // Use dynamic import so the ws package is optional at module load time
    import("ws").then(({ default: WebSocket }) => {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("[synoptic] WebSocket connected");
        attempt = 0; // reset backoff on successful connect
      };

      ws.onmessage = async (event) => {
        try {
          const data =
            typeof event.data === "string"
              ? JSON.parse(event.data)
              : JSON.parse(event.data.toString());

          // Handle array or single post
          const posts: SynopticPost[] = Array.isArray(data) ? data : [data];
          await Promise.all(posts.map(insertPost));
        } catch (err) {
          console.warn(
            `[synoptic] Failed to parse message: ${(err as Error).message}`
          );
        }
      };

      ws.onerror = (err) => {
        console.error(`[synoptic] WebSocket error: ${(err as ErrorEvent).message ?? "unknown"}`);
      };

      ws.onclose = () => {
        console.warn("[synoptic] WebSocket closed — reconnecting...");
        scheduleReconnect(apiKey, attempt + 1);
      };
    });
  } catch (err) {
    console.error(`[synoptic] Failed to create WebSocket: ${(err as Error).message}`);
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
    // Silently skip — activates automatically once key is added to env
    return;
  }
  console.log("[synoptic] Starting WebSocket feed...");
  connect(apiKey);
}
