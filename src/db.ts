// src/db.ts
import Database from "better-sqlite3";
import { existsSync, copyFileSync } from "fs";
import { join } from "path";
import type { Application, Partner } from "./types";

const bundledPath = join(process.cwd(), "loan.db");
const runtimePath =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? "/tmp/loan.db"
    : bundledPath;

if (runtimePath !== bundledPath) {
  try {
    if (existsSync(bundledPath)) {
      copyFileSync(bundledPath, runtimePath);
    }
  } catch (err) {
    console.error("Failed to copy DB to /tmp", err);
  }
}

const db = new Database(runtimePath);
db.exec(`
  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    channel_id TEXT UNIQUE,
    channel_type TEXT DEFAULT 'user'
  );

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

  CREATE TABLE IF NOT EXISTS conversation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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

export function insertConversationLog(log: ConversationLog): void {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO conversation_logs (
        case_id,
        line_user_id,
        role,
        direction,
        channel,
        message_text,
        raw_payload,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    log.case_id,
    log.line_user_id,
    log.role,
    log.direction,
    log.channel,
    log.message_text,
    log.raw_payload ? JSON.stringify(log.raw_payload) : null,
    now
  );
}


// ---------- HELPERS ----------

export function getPartnerByChannelId(channelId: string): Partner | undefined {
  return db
    .prepare("SELECT * FROM partners WHERE channel_id = ?")
    .get(channelId) as Partner | undefined;
}

export function insertPartner(
  name: string,
  channelId: string,
  channelType: "user" | "group"
): void {
  db.prepare(
    `
      INSERT INTO partners (name, channel_id, channel_type)
      VALUES (?, ?, ?)
    `
  ).run(name, channelId, channelType);
}

export function getPartnerById(id: number): Partner | undefined {
  return db
    .prepare("SELECT * FROM partners WHERE id = ?")
    .get(id) as Partner | undefined;
}

export function getPartnerByLine(lineId: string): Partner | undefined {
  return db.prepare("SELECT * FROM partners WHERE line_user_id = ?").get(lineId) as
    | Partner
    | undefined;
}

export function insertApplication(app: Application): void {
  db.prepare(
    `
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
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
  );
}

export function findApplication(query: string): Application | undefined {
  return db
    .prepare(
      `
        SELECT * FROM applications
        WHERE id = ? OR customer_name LIKE ?
        LIMIT 1
      `
    )
    .get(query, `%${query}%`) as Application | undefined;
}

// map status string -> group (ไว้ใช้สี ฯลฯ)
function mapStatusGroup(status: string): string {
  const s = status.trim();
  if (!s) return "pending";
  if (s.includes("อนุมัติ") && !s.includes("ไม่")) return "approved";
  if (s.includes("ไม่อนุมัติ")) return "rejected";
  return "pending";
}

export function updateApplicationStatus(
  id: string,
  status: string,
  creditScore: string | null,
  officerName: string | null,
  collateralValue: number | null
): void {
  const now = new Date().toISOString();
  const statusGroup = mapStatusGroup(status);

  // ดึง loan_amount ปัจจุบันมาใช้คำนวณ LTV
  const row = db
    .prepare("SELECT loan_amount FROM applications WHERE id = ?")
    .get(id) as { loan_amount: number | null } | undefined;

  let ltv: string | null = null;
  if (row && row.loan_amount != null && collateralValue && collateralValue > 0) {
    const ratio = (row.loan_amount / collateralValue) * 100;
    const rounded = Math.round(ratio * 10) / 10; // ปัดทศนิยม 1 ตำแหน่ง
    ltv = `${rounded}%`;
  }

  db.prepare(
    `
    UPDATE applications
    SET status = ?,
        status_group = ?,
        credit_score = ?,
        officer_name = ?,
        collateral_value = COALESCE(?, collateral_value),
        ltv = COALESCE(?, ltv),
        last_status_updated = ?,
        updated_at = ?
    WHERE id = ?
    `
  ).run(
    status,
    statusGroup,
    creditScore,
    officerName,
    collateralValue,
    ltv,
    now,
    now,
    id
  );
}

export function getAllApplications(): Application[] {
  return db
    .prepare("SELECT * FROM applications ORDER BY created_at DESC")
    .all() as Application[];
}


export function getApplicationById(id: string): Application | undefined {
  return db
    .prepare("SELECT * FROM applications WHERE id = ? LIMIT 1")
    .get(id) as Application | undefined;
}

export function getChannelsByCaseId(caseId: string): { channel_id: string; channel_type: "user" | "group" }[] {
  const rows = db
    .prepare(
      `
      SELECT DISTINCT p.channel_id, p.channel_type
      FROM conversation_logs c
      JOIN partners p ON c.line_user_id = p.channel_id
      WHERE c.case_id = ?
    `
    )
    .all(caseId) as { channel_id: string; channel_type: "user" | "group" }[];

  return rows;
}




export default db;
