// src/db.ts
import { Pool } from "pg";
import type { Application, Partner } from "./types";

// ---------------------------------------------------------
//  PostgreSQL connection
// ---------------------------------------------------------
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("❌ DATABASE_URL is missing in environment variables.");
}

export const pool = new Pool({
  connectionString,
  max: 10, // connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// simple wrapper
export async function query(sql: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------
//  Create tables if not exist (run once on cold start)
// ---------------------------------------------------------
(async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS partners (
        id SERIAL PRIMARY KEY,
        name TEXT,
        channel_id TEXT UNIQUE,
        channel_type TEXT DEFAULT 'user'
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        created_at TEXT,
        partner_id INTEGER,
        partner_name TEXT,
        bank_name TEXT,
        customer_name TEXT,
        monthly_income INTEGER,
        property_type TEXT,
        project_name TEXT,
        loan_amount INTEGER,
        collateral_value INTEGER,
        ltv TEXT,
        credit_score TEXT,
        status TEXT,
        status_group TEXT,
        last_status_updated TEXT,
        officer_name TEXT,
        updated_at TEXT
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS conversation_logs (
        id SERIAL PRIMARY KEY,
        case_id TEXT,
        line_user_id TEXT,
        role TEXT,
        direction TEXT,
        channel TEXT,
        message_text TEXT,
        raw_payload TEXT,
        created_at TEXT
      );
    `);
  } catch (err) {
    console.error("❌ Failed to run DB migrations:", err);
  }
})();

// ---------------------------------------------------------
//  helpers
// ---------------------------------------------------------
function mapStatusGroup(status: string): string {
  const s = status.trim();
  if (!s) return "pending";
  if (s.includes("อนุมัติ") && !s.includes("ไม่")) return "approved";
  if (s.includes("ไม่อนุมัติ")) return "rejected";
  return "pending";
}

// ---------------------------------------------------------
//  PARTNER
// ---------------------------------------------------------
export async function getPartnerByChannelId(
  channelId: string
): Promise<Partner | undefined> {
  const rows = await query(
    "SELECT * FROM partners WHERE channel_id = $1 LIMIT 1",
    [channelId]
  );
  return rows[0] as Partner | undefined;
}

export async function insertPartner(
  name: string,
  channelId: string,
  channelType: "user" | "group"
): Promise<void> {
  await query(
    `
      INSERT INTO partners (name, channel_id, channel_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (channel_id) DO NOTHING
    `,
    [name, channelId, channelType]
  );
}

export async function getPartnerById(id: number): Promise<Partner | undefined> {
  const rows = await query("SELECT * FROM partners WHERE id = $1", [id]);
  return rows[0] as Partner | undefined;
}

// ---------------------------------------------------------
//  APPLICATIONS
// ---------------------------------------------------------
export async function insertApplication(app: Application): Promise<void> {
  await query(
    `
      INSERT INTO applications (
        id, created_at, partner_id, partner_name, bank_name,
        customer_name, monthly_income, property_type, project_name,
        loan_amount, collateral_value, ltv, credit_score, status,
        status_group, last_status_updated, officer_name, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
    `,
    [
      app.id,
      app.created_at,
      app.partner_id,
      app.partner_name,
      app.bank_name,
      app.customer_name,
      app.monthly_income,
      app.property_type,
      app.project_name,
      app.loan_amount,
      app.collateral_value,
      app.ltv,
      app.credit_score,
      app.status,
      app.status_group,
      app.last_status_updated,
      app.officer_name,
      app.updated_at
    ]
  );
}

export async function findApplication(q: string): Promise<Application | undefined> {
  const rows = await query(
    `
      SELECT *
      FROM applications
      WHERE id = $1 OR customer_name ILIKE $2
      LIMIT 1
    `,
    [q, `%${q}%`]
  );
  return rows[0] as Application | undefined;
}

export async function getApplicationById(
  id: string
): Promise<Application | undefined> {
  const rows = await query(
    "SELECT * FROM applications WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0] as Application | undefined;
}

export async function getAllApplications(): Promise<Application[]> {
  const rows = await query(
    "SELECT * FROM applications ORDER BY created_at DESC"
  );
  return rows as Application[];
}

// ---------------------------------------------------------
// UPDATE CASE (status + credit_score + LTV ฯลฯ)
// ---------------------------------------------------------
export async function updateApplicationStatus(
  id: string,
  status: string,
  creditScore: string | null,
  officerName: string | null,
  collateralValue: number | null
): Promise<void> {
  const now = new Date().toISOString();
  const statusGroup = mapStatusGroup(status);

  // ดึง loan_amount มาใช้คำนวณ LTV
  const loanRows = await query(
    "SELECT loan_amount FROM applications WHERE id = $1",
    [id]
  );
  const loan_amount = loanRows[0]?.loan_amount as number | null | undefined;

  let ltv: string | null = null;
  if (
    loan_amount != null &&
    collateralValue != null &&
    collateralValue > 0
  ) {
    const ratio = (loan_amount / collateralValue) * 100;
    const rounded = Math.round(ratio * 10) / 10; // ทศนิยม 1 ตำแหน่ง
    ltv = `${rounded}%`;
  }

  await query(
    `
      UPDATE applications
      SET status = $1,
          status_group = $2,
          credit_score = $3,
          officer_name = $4,
          collateral_value = COALESCE($5, collateral_value),
          ltv = COALESCE($6, ltv),
          last_status_updated = $7,
          updated_at = $7
      WHERE id = $8
    `,
    [status, statusGroup, creditScore, officerName, collateralValue, ltv, now, id]
  );
}

// ---------------------------------------------------------
// LOGS
// ---------------------------------------------------------
export async function insertConversationLog(log: any): Promise<void> {
  await query(
    `
      INSERT INTO conversation_logs (
        case_id, line_user_id, role, direction, channel,
        message_text, raw_payload, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      log.case_id,
      log.line_user_id,
      log.role,
      log.direction,
      log.channel,
      log.message_text,
      log.raw_payload ? JSON.stringify(log.raw_payload) : null,
      new Date().toISOString()
    ]
  );
}

// ---------------------------------------------------------
// DELETE HELPERS
// ---------------------------------------------------------
export async function deleteApplicationById(id: string): Promise<void> {
  await query(`DELETE FROM applications WHERE id = $1`, [id]);
}

export async function deleteLogsByCaseId(id: string): Promise<void> {
  await query(`DELETE FROM conversation_logs WHERE case_id = $1`, [id]);
}

export async function deletePartnerById(id: number): Promise<void> {
  await query(`DELETE FROM partners WHERE id = $1`, [id]);
}

// ---------------------------------------------------------
// CHANNELS by case
// ---------------------------------------------------------
export async function getChannelsByCaseId(caseId: string): Promise<
  { channel_id: string; channel_type: "user" | "group" }[]
> {
  const rows = await query(
    `
      SELECT DISTINCT p.channel_id, p.channel_type
      FROM conversation_logs c
      JOIN partners p ON c.line_user_id = p.channel_id
      WHERE c.case_id = $1
    `,
    [caseId]
  );
  return rows as { channel_id: string; channel_type: "user" | "group" }[];
}
