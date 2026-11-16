// Integration tests use TEST_DATABASE_URL (a disposable database). Unit tests need no DB.
if (process.env.TEST_DATABASE_URL) {
  // Same pool size as production (one connection per serverless function): any query that
  // escapes an open transaction deadlocks here and fails the test instead of failing live.
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "5");
  process.env.DATABASE_URL = url.toString();
  process.env.DIRECT_URL = url.toString();
}
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-123456";
