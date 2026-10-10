import { getAllFilters, upsertFilter, deleteFilterByUrl } from "../app/lib/db";
import { compileFilterList, validateFilterListURL } from "../app/lib/compiler";
import { uploadFilter, deleteFilter } from "../app/lib/r2";

async function main() {
  const args = process.argv.slice(2);
  let limit = 0;
  let search = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--search" && args[i + 1]) {
      search = args[i + 1].toLowerCase();
      i++;
    }
  }

  console.log(`[${new Date().toISOString()}] Starting rebuild of filters...`);
  try {
    let filters = await getAllFilters();
    console.log(`Found ${filters.length} filters in database.`);

    if (search) {
      filters = filters.filter(
        (f) => f.name.toLowerCase().includes(search) || f.url.toLowerCase().includes(search)
      );
      console.log(`Filtered by search '${search}': ${filters.length} matches.`);
    }

    if (limit > 0) {
      filters = filters.slice(0, limit);
      console.log(`Limited execution to top ${filters.length} filters.`);
    }

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      console.log(`\n▶ [${i + 1}/${filters.length}] Rebuilding '${filter.name}' (${filter.url})...`);
      try {
        // 1. Validate
        await validateFilterListURL(filter.url);

        // 2. Compile (with contentHash check)
        const result = await compileFilterList(filter.name, filter.url, filter.contentHash);

        if (result.skipped) {
          console.log(`⏩ '${filter.name}' has not changed since last build. Skipped.`);
          continue;
        }

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
          result.fileSize,
          result.contentHash
        );
        console.log(`✓ Successfully rebuilt '${filter.name}'`);
      } catch (err: any) {
        console.error(`✗ Failed for ${filter.url}: ${err.message}. (Skipping to next filter without deleting)`);
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
