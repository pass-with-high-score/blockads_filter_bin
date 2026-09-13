import fs from "fs";
import { sql, ensureMigration } from "../app/lib/db";
import { compileFilterList, validateFilterListURL } from "../app/lib/compiler";
import { uploadFilter } from "../app/lib/r2";

const configPath = "/Users/nqmgaming/IdeaProjects/blockads-default-filter/config.json";
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

async function main() {
  await ensureMigration();
  console.log(`Checking ${config.length} default filters...`);

  for (const item of config) {
    const existing = await sql`
      SELECT id, name, url, r2_download_link, rule_count, is_default 
      FROM filter_lists 
      WHERE url = ${item.url}
    `;

    if (existing.length > 0 && existing[0].r2_download_link) {
      console.log(`✓ Already exists: ${item.name} (${existing[0].rule_count} rules)`);
      await sql`
        UPDATE filter_lists
        SET display_name = ${item.name},
            filter_id = ${item.id},
            description = ${item.description},
            category = ${item.category || "ads"},
            is_default = TRUE,
            is_enabled_by_default = ${item.isEnabled ?? false}
        WHERE id = ${existing[0].id}
      `;
      continue;
    }

    console.log(`\n▶ Compiling missing default filter: ${item.name} (${item.url})...`);
    try {
      await validateFilterListURL(item.url);
      const result = await compileFilterList(item.id, item.url);

      if (result.ruleCount === 0) {
        console.warn(`⚠ 0 rules for ${item.name}, skipping R2 upload`);
        continue;
      }

      let downloadUrl = await uploadFilter(item.id, result.zipData);
      downloadUrl = `${downloadUrl}?v=${Math.floor(Date.now() / 1000)}`;

      await sql`
        INSERT INTO filter_lists (
          name, url, r2_download_link, rule_count, file_size, last_updated,
          display_name, filter_id, description, category, is_default, is_enabled_by_default
        )
        VALUES (
          ${item.id}, ${item.url}, ${downloadUrl}, ${result.ruleCount}, ${result.fileSize}, NOW(),
          ${item.name}, ${item.id}, ${item.description}, ${item.category || "ads"}, TRUE, ${item.isEnabled ?? false}
        )
        ON CONFLICT (url) DO UPDATE
        SET name = EXCLUDED.name,
            r2_download_link = EXCLUDED.r2_download_link,
            rule_count = EXCLUDED.rule_count,
            file_size = EXCLUDED.file_size,
            last_updated = NOW(),
            display_name = EXCLUDED.display_name,
            filter_id = EXCLUDED.filter_id,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            is_default = TRUE,
            is_enabled_by_default = EXCLUDED.is_enabled_by_default
      `;
      console.log(`✅ Successfully compiled & saved: ${item.name} (${result.ruleCount} rules)`);
    } catch (err: any) {
      console.error(`❌ Failed to compile ${item.name}:`, err.message);
    }
  }

  console.log("\n🎉 All default filters processed!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
