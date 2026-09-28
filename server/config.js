// Central config. In production these come from environment variables.
export const PORT = process.env.PORT || 4000;
export const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
export const DB_PATH = process.env.DB_PATH || './data.db';

// The academic term every session belongs to (one term is scheduled at a time).
export const CURRENT_TERM = process.env.CURRENT_TERM || '2025/26-H2';

const DEV_SECRET = 'dev-secret-change-me-in-production';
export const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET;
// Refuse to boot in production with the well-known development secret.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production.');
}
