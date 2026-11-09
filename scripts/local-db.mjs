// Starts a real PostgreSQL server for local development without installing
// PostgreSQL or Docker (uses the `embedded-postgres` binaries).
//   npm run db:local        → listens on localhost:54329, data in ./.local-db
// Matching DATABASE_URL: postgresql://postgres:postgres@localhost:54329/dhm_business_os
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".local-db/data");
const port = Number(process.env.LOCAL_DB_PORT || 54329);
const dbName = process.env.LOCAL_DB_NAME || "dhm_business_os";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  // UTF-8 is required (₹ and other symbols); Windows would otherwise default to WIN1252.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  try {
    await pg.createDatabase(dbName);
  } catch (e) {
    console.warn("createDatabase:", e.message);
  }
}
console.log(`PostgreSQL running on localhost:${port} (database "${dbName}"). Ctrl+C to stop.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
