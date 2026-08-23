import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://dummy_user:dummy_password@localhost:5432/dummy_db";

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

// Run migrations on start
let migrationPromise: Promise<void> | null = null;

export async function ensureMigration() {
  if (migrationPromise) return migrationPromise;
  
  migrationPromise = (async () => {
    console.log("Running PostgreSQL schema migrations...");
    await sql`
      CREATE TABLE IF NOT EXISTS filter_lists (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        r2_download_link TEXT NOT NULL DEFAULT '',
        rule_count INTEGER NOT NULL DEFAULT 0,
        file_size BIGINT NOT NULL DEFAULT 0,
        last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Drop old constraint if exists
    await sql`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'filter_lists_name_key'
        ) THEN
          ALTER TABLE filter_lists DROP CONSTRAINT filter_lists_name_key;
        END IF;
      END $$;
    `;

    // Add unique constraint on url
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'filter_lists_url_key'
        ) THEN
          ALTER TABLE filter_lists ADD CONSTRAINT filter_lists_url_key UNIQUE (url);
        END IF;
      END $$;
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_filter_lists_url ON filter_lists (url);
    `;
    console.log("PostgreSQL schema migrations complete!");
  })();

  return migrationPromise;
}

export interface FilterList {
  id: string;
  name: string;
  url: string;
  r2DownloadLink: string;
  ruleCount: number;
  fileSize: string;
  lastUpdated: string;
  createdAt: string;
}

// Map database column names (snake_case) to application properties (camelCase)
function mapFilterRow(row: any): FilterList {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    r2DownloadLink: row.r2_download_link,
    ruleCount: row.rule_count,
    fileSize: row.file_size,
    lastUpdated: row.last_updated instanceof Date ? row.last_updated.toISOString() : new Date(row.last_updated).toISOString(),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}

export async function upsertFilter(
  name: string,
  url: string,
  r2DownloadLink: string,
  ruleCount: number,
  fileSize: number
): Promise<FilterList> {
  await ensureMigration();
  const rows = await sql`
    INSERT INTO filter_lists (name, url, r2_download_link, rule_count, file_size, last_updated)
    VALUES (${name}, ${url}, ${r2DownloadLink}, ${ruleCount}, ${fileSize}, NOW())
    ON CONFLICT (url) DO UPDATE
    SET name             = EXCLUDED.name,
        r2_download_link = EXCLUDED.r2_download_link,
        rule_count       = EXCLUDED.rule_count,
        file_size        = EXCLUDED.file_size,
        last_updated     = NOW()
    RETURNING id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
  `;
  return mapFilterRow(rows[0]);
}

export async function getFilterByUrl(url: string): Promise<FilterList | null> {
  await ensureMigration();
  const rows = await sql`
    SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
    FROM filter_lists
    WHERE url = ${url}
  `;
  if (rows.length === 0) return null;
  return mapFilterRow(rows[0]);
}

export async function deleteFilterByUrl(url: string): Promise<boolean> {
  await ensureMigration();
  const result = await sql`
    DELETE FROM filter_lists WHERE url = ${url}
  `;
  return result.count > 0;
}

export async function getAllFilters(): Promise<FilterList[]> {
  await ensureMigration();
  const rows = await sql`
    SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
    FROM filter_lists
    ORDER BY name ASC
  `;
  return rows.map(mapFilterRow);
}

export async function getFiltersPaginated(
  page: number,
  limit: number,
  search?: string,
  sort?: string,
  order?: string
): Promise<{ data: FilterList[]; total: number }> {
  await ensureMigration();
  const offset = (page - 1) * limit;

  // Determine order column
  let orderColumn = "last_updated";
  switch (sort) {
    case "time":
      orderColumn = "last_updated";
      break;
    case "size":
      orderColumn = "file_size";
      break;
    case "rule":
      orderColumn = "rule_count";
      break;
    case "name":
      orderColumn = "name";
      break;
  }

  // Determine order direction
  let orderDirection = "DESC";
  if (sort === "name" && !order) {
    orderDirection = "ASC";
  }
  if (order === "asc") orderDirection = "ASC";
  if (order === "desc") orderDirection = "DESC";

  // Build query
  let dataRows;
  let countRows;

  if (search) {
    const searchPattern = `%${search}%`;
    countRows = await sql`
      SELECT COUNT(*) FROM filter_lists 
      WHERE name ILIKE ${searchPattern} OR url ILIKE ${searchPattern}
    `;
    
    if (orderDirection === "ASC") {
      dataRows = await sql`
        SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
        FROM filter_lists
        WHERE name ILIKE ${searchPattern} OR url ILIKE ${searchPattern}
        ORDER BY ${sql(orderColumn)} ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      dataRows = await sql`
        SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
        FROM filter_lists
        WHERE name ILIKE ${searchPattern} OR url ILIKE ${searchPattern}
        ORDER BY ${sql(orderColumn)} DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
  } else {
    countRows = await sql`
      SELECT COUNT(*) FROM filter_lists
    `;
    
    if (orderDirection === "ASC") {
      dataRows = await sql`
        SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
        FROM filter_lists
        ORDER BY ${sql(orderColumn)} ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      dataRows = await sql`
        SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
        FROM filter_lists
        ORDER BY ${sql(orderColumn)} DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
  }

  const total = parseInt(countRows[0].count, 10);
  return {
    data: dataRows.map(mapFilterRow),
    total,
  };
}
