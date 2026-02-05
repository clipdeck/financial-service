import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3004),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  RABBITMQ_URL: z.string().optional(),
  EVENT_EXCHANGE: z.string().default('clipdeck.events'),

  JWT_SECRET: z.string().min(16),

  CDP_API_KEY_NAME: z.string().optional(),
  CDP_API_KEY_PRIVATE_KEY: z.string().optional(),

  CAMPAIGN_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  CLIP_SERVICE_URL: z.string().url().default('http://localhost:3002'),

  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  PLATFORM_FEE_PERCENT: z.coerce.number().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  host: parsed.data.HOST,
  nodeEnv: parsed.data.NODE_ENV,
  logLevel: parsed.data.LOG_LEVEL,
  databaseUrl: parsed.data.DATABASE_URL,
  directUrl: parsed.data.DIRECT_URL,
  rabbitmqUrl: parsed.data.RABBITMQ_URL,
  eventExchange: parsed.data.EVENT_EXCHANGE,
  jwtSecret: parsed.data.JWT_SECRET,
  cdpApiKeyName: parsed.data.CDP_API_KEY_NAME,
  cdpApiKeyPrivateKey: parsed.data.CDP_API_KEY_PRIVATE_KEY,
  campaignServiceUrl: parsed.data.CAMPAIGN_SERVICE_URL,
  clipServiceUrl: parsed.data.CLIP_SERVICE_URL,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
  platformFeePercent: parsed.data.PLATFORM_FEE_PERCENT,
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
};
