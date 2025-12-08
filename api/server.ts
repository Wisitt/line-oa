// api/server.ts

import "dotenv/config";
import { Client } from "@line/bot-sdk";
import {
  getPartnerByChannelId,
  insertPartner,
  findApplication,
  insertApplication,
  updateApplicationStatus,
  getPartnerById,
  insertConversationLog,
  getChannelsByCaseId
} from "../src/db.js";
import type {
  Application,
  ChannelKind,
  ConversationLog,
  UpdateStatusRequest
} from "../src/types";

// ---------- LINE Bot client ----------
const line = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
  channelSecret: process.env.LINE_CHANNEL_SECRET || ""
});

type ChannelType = "user" | "group";

interface ChannelContext {
  id: string;
  type: ChannelType;
  channel: ChannelKind;
  role: "partner" | "bank";
}

const lineConfigReady =
  Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN) &&
  Boolean(process.env.LINE_CHANNEL_SECRET);

if (!lineConfigReady) {
  console.warn(
    "[WARN] LINE credentials are missing. Replies and push messages will fail until environment variables are set."
  );
}

function logLineError(stage: string, err: any) {
  const data = err?.originalError?.response?.data;
  console.error(`LINE ${stage} error:`, data || err);
}

function parseNumber(val: string | null | undefined): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[, ]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function getChannelContext(source: any): ChannelContext {
  if (source.type === "group") {
    return {
      id: source.groupId,
      type: "group",
      channel: "line-group",
      role: "bank"
    };
  }

  return {
    id: source.userId,
    type: "user",
    channel: "line",
    role: "partner"
  };
}

async function logConversationSafe(entry: ConversationLog): Promise<void> {
  try {
    await insertConversationLog(entry);
  } catch (err) {
    console.error("DB error (conversation log):", err);
  }
}

async function replyWithFallback(
  event: any,
  ctx: ChannelContext,
  message: string,
  caseId: string | null = null
): Promise<void> {
  await logConversationSafe({
    case_id: caseId,
    line_user_id: ctx.id,
    role: "bot",
    direction: "outgoing",
    channel: ctx.channel,
    message_text: message,
    raw_payload: null
  });

  if (!lineConfigReady) {
    console.error("Skip sending message because LINE credentials are not configured.");
    return;
  }

  const payload = { type: "text" as const, text: message };

  try {
    await line.replyMessage(event.replyToken, payload);
  } catch (err: any) {
    logLineError("reply", err);

    try {
      await line.pushMessage(ctx.id, payload);
    } catch (pushErr) {
      logLineError("push (fallback)", pushErr);
    }
  }
}

// ---------- Helpers ----------
export function formatBaht(num: number | null | undefined): string {
  if (num == null || isNaN(num)) return "-";
  return "฿" + Number(num).toLocaleString("th-TH");
}

export function formatThaiDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  const months = [
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค."
  ];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = (d.getFullYear() + 543) % 100;
  return `${day} ${month} ${year}`;
}

export function statusClass(status: string | null | undefined): string {
  const s = (status || "").trim();
  if (!s) return "status-pill status-default";
  if (s.includes("อนุมัติ") && !s.includes("ไม่")) return "status-pill status-success";
  if (s.includes("ไม่อนุมัติ")) return "status-pill status-danger";
  if (s.includes("รอเอกสาร")) return "status-pill status-warning";
  if (s.includes("รอประเมิน")) return "status-pill status-info";
  return "status-pill status-default";
}

export function creditScoreClass(score: string | null | undefined): string {
  const n = Number(score);
  if (isNaN(n)) return "score-neutral";
  if (n >= 760) return "score-good";
  if (n >= 680) return "score-mid";
  return "score-low";
}

export function ltvClass(ltv: string | null | undefined): string {
  if (!ltv) return "ltv-neutral";
  const num = parseFloat(String(ltv).replace("%", ""));
  if (isNaN(num)) return "ltv-neutral";
  return num >= 100 ? "ltv-high" : "ltv-neutral";
}

export function genId(): string {
  const year = new Date().getFullYear();
  const rnd = ("0000" + Math.floor(Math.random() * 9999)).slice(-4);
  return `HL-${year}-${rnd}`;
}

export function baht(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "-";
  return "฿" + Number(n).toLocaleString("th-TH");
}

export function extractCaseId(text: string): string | null {
  const match = text.match(/HL-?\d{4}-?\d{4}/i);
  if (!match) return null;

  const digits = match[0].replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;

  const year = digits.slice(0, 4);
  const suffix = digits.slice(4);
  return `HL-${year}-${suffix}`;
}

const STATUS_KEYWORDS = [
  { word: "อนุมัติแล้ว", status: "อนุมัติแล้ว" },
  { word: "ไม่อนุมัติ", status: "ไม่อนุมัติ" },
  { word: "รอเอกสาร", status: "รอเอกสารเพิ่ม" },
  { word: "รอประเมิน", status: "รอประเมินราคา" },
  { word: "รอพิจารณา", status: "รอพิจารณา" }
];

export function extractStatus(text: string): string | null {
  const t = text.toLowerCase();
  for (const s of STATUS_KEYWORDS) {
    if (t.includes(s.word)) return s.status;
  }
  return null;
}

function helpMessage(): string {
  return (
    "สวัสดีครับ ระบบสินเชื่อบ้าน\n\n" +
    "• เปิดเคสใหม่:\n" +
    "#เปิดเคส ชื่อลูกค้า=... | เงินเดือน=... | วงเงิน=...\n\n" +
    "• เช็คสถานะเคส:\n" +
    "#เช็คเคส เลขเคส หรือชื่อลูกค้า"
  );
}

function parseNewCasePayload(
  text: string
):
  | { ok: true; data: Partial<Application> }
  | { ok: false; error: string } {
  let cleaned = text.replace(
    /(เงินเดือน|รายได้|วงเงิน|ยอดกู้|ทรัพย์|โครงการ)\s*=/g,
    "|$1="
  );
  if (cleaned.startsWith("|")) cleaned = cleaned.slice(1).trim();

  const parts = cleaned
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

  const data: Partial<Application> = {
    customer_name: "",
    monthly_income: null,
    loan_amount: null,
    property_type: "",
    project_name: ""
  };

  let sawIncome = false;
  let sawLoan = false;

  for (const part of parts) {
    const [rawKey = "", rawVal] = part.split("=");
    const key = rawKey.trim();
    const val = rawVal?.trim();
    if (!key || !val) continue;

    if (key.includes("ชื่อลูกค้า")) data.customer_name = val;
    else if (key.includes("เงินเดือน") || key.includes("รายได้")) {
      sawIncome = true;
      data.monthly_income = parseNumber(val);
    } else if (key.includes("วงเงิน") || key.includes("ยอดกู้")) {
      sawLoan = true;
      data.loan_amount = parseNumber(val);
    } else if (key.includes("ทรัพย์")) data.property_type = val;
    else if (key.includes("โครงการ")) data.project_name = val;
  }

  if (!data.customer_name) {
    return {
      ok: false,
      error:
        "❌ ข้อมูลไม่ครบ\nตัวอย่าง: #เปิดเคส ชื่อลูกค้า=นายสมชาย | เงินเดือน=85000 | วงเงิน=5000000"
    };
  }

  if (sawIncome && data.monthly_income === null) {
    return { ok: false, error: "❌ กรุณากรอกเงินเดือนเป็นตัวเลข เช่น 85000" };
  }

  if (sawLoan && data.loan_amount === null) {
    return { ok: false, error: "❌ กรุณากรอกวงเงินเป็นตัวเลข เช่น 5000000" };
  }

  return { ok: true, data };
}

// --------------------------------------------------
//  LINE EVENT HANDLER
// --------------------------------------------------
export async function handleEvent(event: any) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text: string = event.message.text.trim();
  const lower = text.toLowerCase();
  const ctx = getChannelContext(event.source);
  const caseIdFromMessage = extractCaseId(text);

  // partner + log
  let partner = await getPartnerByChannelId(ctx.id);
  if (!partner) {
    await insertPartner(`partner-${Date.now()}`, ctx.id, ctx.type);
    partner = await getPartnerByChannelId(ctx.id);
    if (!partner) {
      console.error("Failed to create partner record");
      await replyWithFallback(
        event,
        ctx,
        "❌ ระบบขัดข้อง ไม่สามารถผูก Partner กับ LINE ได้",
        caseIdFromMessage
      );
      return;
    }
  }

  await logConversationSafe({
    case_id: caseIdFromMessage,
    line_user_id: ctx.id,
    role: ctx.role,
    direction: "incoming",
    channel: ctx.channel,
    message_text: text,
    raw_payload: event
  });

  // --------------------------------------------------
  //  เปิดเคสใหม่
  // --------------------------------------------------
  const CMD_NEW = ["#เปิดเคส", "#สมัครกู้", "ลงทะเบียนกู้:"];
  if (CMD_NEW.some((p) => lower.startsWith(p.toLowerCase()))) {
    let cleaned = text;

    CMD_NEW.forEach((p) => {
      if (cleaned.toLowerCase().startsWith(p.toLowerCase())) {
        cleaned = cleaned.slice(p.length).trim();
      }
    });

    const parsed = parseNewCasePayload(cleaned);
    if (!parsed.ok) {
      await replyWithFallback(event, ctx, parsed.error, null);
      return;
    }

    const a = parsed.data;
    const now = new Date().toISOString();
    const id = genId();

    const newApp: Application = {
      id,
      created_at: now,
      partner_id: partner.id,
      partner_name: partner?.name ?? "",
      bank_name: "KBank",
      customer_name: a.customer_name || "",
      monthly_income: a.monthly_income ?? null,
      property_type: a.property_type || "",
      project_name: a.project_name || "",
      loan_amount: a.loan_amount ?? null,
      collateral_value: null,
      ltv: null,
      credit_score: null,
      status: "รอพิจารณา",
      status_group: "pending",
      last_status_updated: now,
      officer_name: null,
      updated_at: now
    };

    try {
      await insertApplication(newApp);
    } catch (err) {
      console.error("DB error (insertApplication):", err);
      await replyWithFallback(
        event,
        ctx,
        "❌ ระบบขัดข้อง ไม่สามารถบันทึกเคสได้ กรุณาลองใหม่อีกครั้ง",
        null
      );
      return;
    }

    await logConversationSafe({
      case_id: id,
      line_user_id: ctx.id,
      role: ctx.role,
      direction: "incoming",
      channel: ctx.channel,
      message_text: text,
      raw_payload: event
    });

    await replyWithFallback(
      event,
      ctx,
      `✅ เปิดเคสใหม่แล้ว\n` +
        `เลขเคส: ${id}\n` +
        `ชื่อลูกค้า: ${a.customer_name}\n` +
        `เงินเดือน: ${baht(a.monthly_income)}\n` +
        `ยอดกู้: ${baht(a.loan_amount)}\n` +
        `โครงการ: ${a.project_name}`,
      id
    );
    return;
  }

  // --------------------------------------------------
  //  เช็คเคส
  // --------------------------------------------------
  const CMD_CHECK = ["#เช็คเคส", "#สถานะ", "#เช็คสถานะ"];
  if (CMD_CHECK.some((p) => lower.startsWith(p.toLowerCase()))) {
    const query = text.replace(/^#เช็คเคส|^#สถานะ|^#เช็คสถานะ/i, "").trim();
    if (!query) {
      await replyWithFallback(event, ctx, "กรุณาระบุเลขเคส หรือชื่อลูกค้า", caseIdFromMessage);
      return;
    }

    let app: Application | undefined;
    try {
      app = await findApplication(query);
    } catch (err) {
      console.error("DB error (findApplication):", err);
      await replyWithFallback(
        event,
        ctx,
        "❌ ระบบขัดข้อง ไม่สามารถค้นหาเคสได้ กรุณาลองใหม่อีกครั้ง",
        caseIdFromMessage
      );
      return;
    }

    if (!app) {
      await replyWithFallback(event, ctx, `❌ ไม่พบเคส "${query}"`, caseIdFromMessage);
      return;
    }

    await logConversationSafe({
      case_id: app.id,
      line_user_id: ctx.id,
      role: ctx.role,
      direction: "incoming",
      channel: ctx.channel,
      message_text: text,
      raw_payload: event
    });

    const ltvText = app.ltv ? ` (LTV ${app.ltv})` : "";
    await replyWithFallback(
      event,
      ctx,
      `📌 รายละเอียดเคส\n` +
        `เลขเคส: ${app.id}\n` +
        `ชื่อลูกค้า: ${app.customer_name}\n` +
        `เงินเดือน: ${baht(app.monthly_income)}\n` +
        `โครงการ: ${app.project_name}\n` +
        `ยอดกู้: ${baht(app.loan_amount)}${ltvText}\n` +
        `สถานะ: ${app.status}\n` +
        `เครดิตสกอร์: ${app.credit_score ?? "-"}`,
      app.id
    );
    return;
  }

  // --------------------------------------------------
  //  Default help
  // --------------------------------------------------
  await replyWithFallback(event, ctx, helpMessage(), caseIdFromMessage);
}

// --------------------------------------------------
//  ADMIN UPDATE (จาก backoffice)
// --------------------------------------------------
export async function handleAdminUpdate(body: UpdateStatusRequest) {
  const { id, status, credit_score, officer_name, collateral_value } = body;

  try {
    await updateApplicationStatus(
      id,
      status,
      credit_score || null,
      officer_name || null,
      collateral_value ?? null
    );
  } catch (err) {
    console.error("DB error (updateApplicationStatus):", err);
    return { ok: false };
  }

  const app = await findApplication(id);
  if (!app) return { ok: false };

  const pushText =
    `📢 อัปเดตเคส\n` +
    `เลขเคส: ${id}\n` +
    `สถานะ: ${status}\n` +
    `เครดิตสกอร์: ${credit_score ?? "-"}\n` +
    (officer_name ? `โดย: ${officer_name}` : "");

  const channels = await getChannelsByCaseId(id);

  // fallback partner เดิม ถ้าไม่มี log อะไรเลย
  if (!channels.length) {
    const partner = await getPartnerById(app.partner_id);
    if (partner) {
      const targetId = partner.channel_id;
      await line.pushMessage(targetId, { type: "text", text: pushText });

      await insertConversationLog({
        case_id: id,
        line_user_id: targetId,
        role: "bot",
        direction: "outgoing",
        channel: partner.channel_type === "group" ? "line-group" : "line",
        message_text: pushText,
        raw_payload: null
      });
    }
  }

  for (const ch of channels) {
    await line.pushMessage(ch.channel_id, {
      type: "text",
      text: pushText
    });

    try {
      await insertConversationLog({
        case_id: id,
        line_user_id: ch.channel_id,
        role: "bot",
        direction: "outgoing",
        channel: ch.channel_type === "group" ? "line-group" : "line",
        message_text: pushText,
        raw_payload: null
      });
    } catch (err) {
      console.error("DB error (insertConversationLog in admin):", err);
    }
  }

  return { ok: true };
}
