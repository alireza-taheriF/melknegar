// Runtime configuration from environment variables.
const env = process.env;

export const config = {
  masterKey: env.MASTER_KEY || '',
  appUrl: (env.APP_URL || '').replace(/\/$/, ''),
  aiKey: env.AI_GATEWAY_API_KEY || '',
  aiModel: env.AI_MODEL || 'google/gemini-3.6-flash',
  aiBase: 'https://ai-gateway.vercel.sh/v1',
  blobToken: env.BLOB_READ_WRITE_TOKEN || '',
  redisUrl: env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '',
  redisToken: env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '',
  localDataDir: env.LOCAL_DATA_DIR || '',
  seed: env.SEED_DATA || '',
  isProd: env.VERCEL_ENV === 'production',
  sessionDays: 30,
};

export function assertConfigured() {
  if (!config.masterKey && !config.blobToken) throw new Error('MASTER_KEY is not set');
}
