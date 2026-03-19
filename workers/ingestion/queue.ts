import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";

export interface ArticleIngestJob {
  articleId: string;
}

const QUEUE_NAME = "article-ingest";

// Concurrency limits (ARCHITECTURE.md §8.3)
// max 10 concurrent fast-model calls, max 3 Opus/deep-research calls
export const FAST_MODEL_CONCURRENCY = 10;
export const DEEP_MODEL_CONCURRENCY = 3;

export function getRedisConnectionOptions(): ConnectionOptions {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL env var is required");
  // Pass URL as a plain options object so BullMQ uses its own bundled ioredis
  return { url, maxRetriesPerRequest: null } as ConnectionOptions;
}

export function createIngestQueue(connection: ConnectionOptions) {
  return new Queue<ArticleIngestJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}

export function createIngestWorker(
  connection: ConnectionOptions,
  processor: (job: Job<ArticleIngestJob>) => Promise<void>
) {
  return new Worker<ArticleIngestJob>(QUEUE_NAME, processor, {
    connection,
    concurrency: FAST_MODEL_CONCURRENCY,
  });
}
