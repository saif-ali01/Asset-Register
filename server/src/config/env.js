import dotenv from 'dotenv';
dotenv.config();

const required = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env.`);
  process.exit(1);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  /**
   * Domain used when the importer has to invent an email for a person named
   * only by their display name in the register. Built in as nutraj.com;
   * override with EMAIL_DOMAIN for a different company.
   */
  emailDomain: (process.env.EMAIL_DOMAIN || 'nutraj.com').replace(/^@/, '').toLowerCase(),
  /** The first super admin. Fully configurable, and never guessed. */
  adminEmail: (process.env.SEED_ADMIN_EMAIL || 'admin@nutraj.com').toLowerCase(),
  adminName: process.env.SEED_ADMIN_NAME || 'IT Administrator',
  adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI,
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  accessSecret: process.env.JWT_ACCESS_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  isProd: process.env.NODE_ENV === 'production',
};
