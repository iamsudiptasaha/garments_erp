const value = process.env.TEST_DATABASE_URL;
if (!value) throw Error('TEST_DATABASE_URL is required');
const url = new URL(value);
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
  url.port !== '55422' ||
  url.pathname !== '/postgres'
)
  throw Error('Database tests accept only the dedicated localhost:55422/postgres test database');
if (
  process.env.SUPABASE_ACCESS_TOKEN ||
  process.env.SUPABASE_DB_PASSWORD ||
  process.env.PRODUCTION_DATABASE_URL
)
  throw Error('Production credentials must not be present in database-test jobs');
console.log('Isolated database target verified');
