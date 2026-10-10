import { sql } from "../app/lib/db";
async function run() {
  const rows = await sql`
    SELECT id, filter_id, display_name, url 
    FROM filter_lists 
    WHERE is_default = TRUE
    ORDER BY id ASC;
  `;
  for (const r of rows) {
    console.log(`${r.filter_id}: ${r.display_name}`);
  }
  process.exit(0);
}
run();
