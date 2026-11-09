// Integration tests use TEST_DATABASE_URL (a disposable database). Unit tests need no DB.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
}
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-123456";
