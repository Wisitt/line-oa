import { Database } from "bun:sqlite";

const dbPath = Bun.argv[2] ?? "loan.db";

let db: Database;

try {
  db = new Database(dbPath, { readonly: true });
} catch (error) {
  console.error(`Failed to open ${dbPath}`);
  console.error(error);
  process.exit(1);
}

const tables = db
  .query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  .all()
  .map((row: any) => row.name as string);

if (!tables.length) {
  console.log(`No tables found in ${dbPath}`);
  process.exit(0);
}

console.log(`Reading ${dbPath}`);
console.log(`Tables: ${tables.join(", ")}`);

for (const table of tables) {
  const countRow = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  const rows = db.query(`SELECT * FROM ${table} LIMIT 50`).all();

  console.log(`\n== ${table} (total: ${countRow.count}, showing up to 50) ==`);

  if (!rows.length) {
    console.log("(empty)");
    continue;
  }

  console.table(rows);
}

db.close();
