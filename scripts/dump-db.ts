import Database from "better-sqlite3";

const dbPath = process.argv[2] ?? "loan.db";

const db = new Database(dbPath, { readonly: true });

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
