import postgres from "postgres";

export interface CompilerEnv {
  HYPERDRIVE: {
    connectionString: string;
  };
  FILTERS_BUCKET: any;
  R2_PUBLIC_URL: string;
  DATABASE_URL?: string;
}

export async function upsertFilterRecord(
  env: CompilerEnv,
  name: string,
  url: string,
  r2DownloadLink: string,
  ruleCount: number,
  fileSize: number,
  contentHash: string
) {
  const connStr = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connStr) {
    console.warn("[DB] No connection string available to upsert filter");
    return;
  }

  const sql = postgres(connStr, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 10,
  });

  try {
    await sql`
      INSERT INTO filter_lists (name, url, r2_download_link, rule_count, file_size, content_hash, last_updated)
      VALUES (${name}, ${url}, ${r2DownloadLink}, ${ruleCount}, ${fileSize}, ${contentHash}, NOW())
      ON CONFLICT (url) DO UPDATE
      SET name             = EXCLUDED.name,
          r2_download_link = EXCLUDED.r2_download_link,
          rule_count       = EXCLUDED.rule_count,
          file_size        = EXCLUDED.file_size,
          content_hash     = EXCLUDED.content_hash,
          last_updated     = NOW()
    `;
    console.log(`[DB] ✓ Upserted record for: ${url}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
