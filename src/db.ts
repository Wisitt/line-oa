// src/db.ts
import { sql } from "@vercel/postgres";
import type { Application, Partner } from "./types";

export type ConversationChannel = "line" | "line-group" | "backoffice";

export interface ConversationLog {
  case_id: string | null;
  line_user_id: string | null;
  role: "partner" | "bank" | "bot";
  direction: "incoming" | "outgoing";
  channel: ConversationChannel;
  message_text: string;
  raw_payload?: any;
}

// ---------- INIT SCHEMA (run once per cold start) ----------
const initPromise = (async () => {
  // partners
  await sql`
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      name TEXT,
      channel_id TEXT UNIQUE,
      channel_type TEXT DEFAULT 'user'
    );
  `;

  // applications
  await sql`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      created_at TEXT,
      partner_id INTEGER REFERENCES partners(id),
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
  `;

  // conversation_logs
  await sql`
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
  `;
})();

// ---------- LOG ----------
export async function insertConversationLog(log: ConversationLog): Promise<void> {
  await initPromise;
  const now = new Date().toISOString();
  await sql`
    INSERT INTO conversation_logs (
      case_id,
      line_user_id,
      role,
      direction,
      channel,
      message_text,
      raw_payload,
      created_at
    ) VALUES (
      ${log.case_id},
      ${log.line_user_id},
      ${log.role},
      ${log.direction},
      ${log.channel},
      ${log.message_text},
      ${log.raw_payload ? JSON.stringify(log.raw_payload) : null},
      ${now}
    );
  `;
}

// ---------- HELPERS: PARTNERS ----------
export async function getPartnerByChannelId(channelId: string): Promise<Partner | undefined> {
  await initPromise;
  const { rows } = await sql<Partner>`
    SELECT * FROM partners WHERE channel_id = ${channelId} LIMIT 1;
  `;
  return rows[0];
}

export async function insertPartner(
  name: string,
  channelId: string,
  channelType: "user" | "group"
): Promise<void> {
  await initPromise;
  await sql`
    INSERT INTO partners (name, channel_id, channel_type)
    VALUES (${name}, ${channelId}, ${channelType})
    ON CONFLICT (channel_id) DO NOTHING;
  `;
}

export async function getPartnerById(id: number): Promise<Partner | undefined> {
  await initPromise;
  const { rows } = await sql<Partner>`
    SELECT * FROM partners WHERE id = ${id} LIMIT 1;
  `;
  return rows[0];
}

export async function getPartnerByLine(lineId: string): Promise<Partner | undefined> {
  await initPromise;
  const { rows } = await sql<Partner>`
    SELECT * FROM partners WHERE channel_id = ${lineId} LIMIT 1;
  `;
  return rows[0];
}

// ---------- HELPERS: APPLICATIONS ----------
export async function insertApplication(app: Application): Promise<void> {
  await initPromise;
  await sql`
    INSERT INTO applications (
      id,
      created_at,
      partner_id,
      partner_name,
      bank_name,
      customer_name,
      monthly_income,
      property_type,
      project_name,
      loan_amount,
      collateral_value,
      ltv,
      credit_score,
      status,
      status_group,
      last_status_updated,
      officer_name,
      updated_at
    ) VALUES (
      ${app.id},
      ${app.created_at},
      ${app.partner_id},
      ${app.partner_name},
      ${app.bank_name},
      ${app.customer_name},
      ${app.monthly_income},
      ${app.property_type},
      ${app.project_name},
      ${app.loan_amount},
      ${app.collateral_value},
      ${app.ltv},
      ${app.credit_score},
      ${app.status},
      ${app.status_group},
      ${app.last_status_updated},
      ${app.officer_name},
      ${app.updated_at}
    );
  `;
}

export async function findApplication(query: string): Promise<Application | undefined> {
  await initPromise;
  const like = `%${query}%`;
  const { rows } = await sql<Application>`
    SELECT * FROM applications
    WHERE id = ${query} OR customer_name ILIKE ${like}
    LIMIT 1;
  `;
  return rows[0];
}

// map status string -> group (ไว้ใช้สี ฯลฯ)
function mapStatusGroup(status: string): string {
  const s = status.trim();
  if (!s) return "pending";
  if (s.includes("อนุมัติ") && !s.includes("ไม่")) return "approved";
  if (s.includes("ไม่อนุมัติ")) return "rejected";
  return "pending";
}

export async function updateApplicationStatus(
  id: string,
  status: string,
  creditScore: string | null,
  officerName: string | null,
  collateralValue: number | null
): Promise<void> {
  await initPromise;
  const now = new Date().toISOString();
  const statusGroup = mapStatusGroup(status);

  // ดึง loan_amount เพื่อนำมาคำนวณ LTV
  const loanRes = await sql<{ loan_amount: number | null }>`
    SELECT loan_amount FROM applications WHERE id = ${id} LIMIT 1;
  `;
  const row = loanRes.rows[0];

  let ltv: string | null = null;
  if (row && row.loan_amount != null && collateralValue && collateralValue > 0) {
    const ratio = (row.loan_amount / collateralValue) * 100;
    const rounded = Math.round(ratio * 10) / 10;
    ltv = `${rounded}%`;
  }

  await sql`
    UPDATE applications
    SET status = ${status},
        status_group = ${statusGroup},
        credit_score = ${creditScore},
        officer_name = ${officerName},
        collateral_value = COALESCE(${collateralValue}, collateral_value),
        ltv = COALESCE(${ltv}, ltv),
        last_status_updated = ${now},
        updated_at = ${now}
    WHERE id = ${id};
  `;
}

export async function getAllApplications(): Promise<Application[]> {
  await initPromise;
  const { rows } = await sql<Application>`
    SELECT * FROM applications ORDER BY created_at DESC;
  `;
  return rows;
}

export async function getApplicationById(id: string): Promise<Application | undefined> {
  await initPromise;
  const { rows } = await sql<Application>`
    SELECT * FROM applications WHERE id = ${id} LIMIT 1;
  `;
  return rows[0];
}

export async function getChannelsByCaseId(
  caseId: string
): Promise<{ channel_id: string; channel_type: "user" | "group" }[]> {
  await initPromise;
  const { rows } = await sql<{ channel_id: string; channel_type: "user" | "group" }>`
    SELECT DISTINCT p.channel_id, p.channel_type
    FROM conversation_logs c
    JOIN partners p ON c.line_user_id = p.channel_id
    WHERE c.case_id = ${caseId};
  `;
  return rows;
}

export async function deleteApplicationById(id: string): Promise<void> {
  await initPromise;
  await sql`DELETE FROM applications WHERE id = ${id};`;
}

export async function deletePartnerById(id: number): Promise<void> {
  await initPromise;
  await sql`DELETE FROM partners WHERE id = ${id};`;
}

export async function deleteLogsByCaseId(caseId: string): Promise<void> {
  await initPromise;
  await sql`DELETE FROM conversation_logs WHERE case_id = ${caseId};`;
}
