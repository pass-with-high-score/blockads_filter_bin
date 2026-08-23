import { getAllFilters, upsertFilter, deleteFilterByUrl } from "../app/lib/db";
import { compileFilterList, validateFilterListURL } from "../app/lib/compiler";
import { uploadFilter, deleteFilter } from "../app/lib/r2";

async function main() {
  console.log(`[${new Date().toISOString()}] Starting local rebuild of all filters...`);
  try {
    const filters = await getAllFilters();
    console.log(`Found ${filters.length} filters in database.`);

    for (const filter of filters) {
      console.log(`\nRebuilding '${filter.name}' (${filter.url})...`);
      try {
        // 1. Validate
        await validateFilterListURL(filter.url);

        // 2. Compile
        const result = await compileFilterList(filter.name, filter.url);

        if (result.ruleCount === 0) {
          throw new Error("No domain rules found in filter list");
        }

        // 3. Upload to R2
        let downloadUrl = await uploadFilter(filter.name, result.zipData);

        // 4. Cache-buster query param
        downloadUrl = `${downloadUrl}?v=${Math.floor(Date.now() / 1000)}`;

        // 5. Update Database
        await upsertFilter(
          filter.name,
          filter.url,
          downloadUrl,
          result.ruleCount,
          result.fileSize
        );
        console.log(`✓ Successfully rebuilt '${filter.name}'`);
      } catch (err: any) {
        console.error(`✗ Failed for ${filter.url}: ${err.message}. Removing from database.`);
        try {
          await deleteFilter(filter.name);
        } catch (r2Err) {}
        await deleteFilterByUrl(filter.url).catch(() => {});
      }
    }
    console.log(`\n[${new Date().toISOString()}] ✓ Local rebuild of all filters complete!`);
  } catch (err: any) {
    console.error("Fatal rebuild error:", err);
  } finally {
    // Close the postgres database connection pool before exiting
    process.exit(0);
  }
}

main();
