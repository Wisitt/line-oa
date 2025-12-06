import Database from "better-sqlite3";
import { writeFileSync } from "fs";

const dbPath = process.argv[2] ?? "loan.db";
const outPath = process.argv[3] ?? "db-export.txt";

const db = new Database(dbPath, { readonly: true });

const tables = db
  .query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  .all()
  .map((row: any) => row.name as string);

function getColumns(table: string): string[] {
  return db
    .query(`PRAGMA table_info(${table})`)
    .all()
    .map((row: any) => row.name as string);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v);
}

let buffer: string[] = [];

buffer.push(`# DB export from ${dbPath}`);
buffer.push(`Generated: ${new Date().toISOString()}`);
buffer.push("");

if (!tables.length) {
  buffer.push("(no tables found)");
} else {
  for (const table of tables) {
    const columns = getColumns(table);
    const rows = db.query(`SELECT * FROM ${table}`).all();

    buffer.push(`## ${table} (rows: ${rows.length})`);
    buffer.push(columns.join(" | "));
    buffer.push("-".repeat(columns.join(" | ").length));

    for (const row of rows) {
      const line = columns.map((c) => formatValue((row as any)[c])).join(" | ");
      buffer.push(line);
    }
    buffer.push("");
  }
}

writeFileSync(outPath, buffer.join("\n"), "utf8");
console.log(`Written ${outPath}`);
