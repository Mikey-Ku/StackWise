/**
 * The read-only SQL console's rules. The database enforces read-only itself (Postgres runs the
 * query in a READ ONLY transaction that's rolled back, SQLite opens the file read-only), and
 * these checks come first so a write is refused with a plain reason before it's sent anywhere.
 */

export const ROW_LIMIT = 200;
export const TIMEOUT_MS = 5000;

const READS = new Set(["select", "with", "show", "explain", "values", "table", "pragma", "describe"]);

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Null when the query is one statement that only reads; otherwise the reason it won't run. */
export function checkReadOnly(sql: string): string | null {
  const text = stripComments(sql).trim().replace(/;\s*$/, "");
  if (!text) return "Type a query, like SELECT * FROM users LIMIT 10.";
  // A semicolon outside quotes means a second statement.
  const outsideQuotes = text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "''");
  if (outsideQuotes.includes(";")) return "Run one statement at a time.";
  const first = text.split(/\s+/)[0].toLowerCase();
  if (!READS.has(first)) return `Only reading is on for this database, and ${first.toUpperCase()} changes it. Queries that start with SELECT, WITH, SHOW or EXPLAIN work.`;
  if (first === "pragma" && /=/.test(text)) return "A PRAGMA that sets something changes the database.";
  return null;
}

export interface PgConfig {
  connectionString: string;
}

/**
 * A Postgres connection from what the project has: a postgres:// URL, or Spring's JDBC URL with
 * its username and password in separate variables. Null when it isn't Postgres.
 */
export function postgresFrom(env: Record<string, string>): { config: PgConfig; from: string } | null {
  const direct = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED"].find((n) => /^postgres(ql)?:\/\//.test(env[n] ?? ""));
  if (direct) return { config: { connectionString: env[direct] }, from: direct };
  const jdbc = env.SPRING_DATASOURCE_URL ?? env.JDBC_DATABASE_URL;
  const match = jdbc?.match(/^jdbc:postgresql:\/\/(.+)$/);
  if (!match) return null;
  const url = new URL(`postgresql://${match[1]}`);
  const user = env.SPRING_DATASOURCE_USERNAME ?? url.searchParams.get("user");
  const password = env.SPRING_DATASOURCE_PASSWORD ?? url.searchParams.get("password");
  url.searchParams.delete("user");
  url.searchParams.delete("password");
  if (user) url.username = encodeURIComponent(user);
  if (password) url.password = encodeURIComponent(password);
  return { config: { connectionString: url.toString() }, from: env.SPRING_DATASOURCE_URL ? "SPRING_DATASOURCE_URL" : "JDBC_DATABASE_URL" };
}

/** A SQLite file the project points at, relative to the project folder. */
export function sqliteFrom(env: Record<string, string>): string | null {
  const value = env.DATABASE_URL ?? env.SQLITE_PATH ?? "";
  const match = value.match(/^(?:file:|sqlite:\/\/)?(.+\.(?:db|sqlite3?))$/);
  return match ? match[1] : null;
}
