// api/server.ts
// Shared logic (no server runtime) for LINE handlers and admin updates

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
import type { Application, UpdateStatusRequest } from "../src/types";

// ---------- LINE Bot client ----------
const line = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
  channelSecret: process.env.LINE_CHANNEL_SECRET || ""
});

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
  const m = text.match(/HL-?\d{4,}/i);
  return m ? m[0].replace(/-/g, "") : null;
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

// --------------------------------------------------
//  LINE EVENT HANDLER
// --------------------------------------------------
export async function handleEvent(event: any) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text: string = event.message.text.trim();
  const lower = text.toLowerCase();

  // ---- ระบุต้นทาง user / group ----
  const source = event.source;
  let channelId: string;
  let channelType: "user" | "group";

  if (source.type === "group") {
    channelId = source.groupId;
    channelType = "group";
  } else {
    channelId = source.userId;
    channelType = "user";
  }

  // ---- ensure partner (กัน error DB ไม่ให้ kill flow หลัก) ----
  let partner: any | null = null;
  try {
    partner = getPartnerByChannelId(channelId);
    if (!partner) {
      insertPartner(`partner-${Date.now()}`, channelId, channelType);
      partner = getPartnerByChannelId(channelId);
    }
  } catch (err) {
    console.error("DB error (partner):", err);
    partner = null; // ยังให้ flow ตอบ LINE ต่อไปได้
  }

  // ---- log conversation (กัน error DB ไม่ให้ kill flow หลัก) ----
  try {
    insertConversationLog({
      case_id: null,
      line_user_id: channelId,
      role: channelType === "group" ? "bank" : "partner",
      direction: "incoming",
      channel: channelType === "group" ? "line-group" : "line",
      message_text: text,
      raw_payload: event
    });
  } catch (err) {
    console.error("DB error (conversation log):", err);
  }

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

    // normalize key=value ให้แยกด้วย |
    cleaned = cleaned.replace(
      /(เงินเดือน|รายได้|วงเงิน|ยอดกู้|ทรัพย์|โครงการ)\s*=/g,
      "|$1="
    );
    if (cleaned.startsWith("|")) cleaned = cleaned.slice(1).trim();

    const parts = cleaned.split("|").map((x) => x.trim());
    const a: Partial<Application> = {
      customer_name: "",
      monthly_income: null,
      loan_amount: null,
      property_type: "",
      project_name: ""
    };

    for (const part of parts) {
      const [rawKey = "", rawVal] = part.split("=");
      if (!rawVal) continue;

      const key = rawKey.trim();
      const val = rawVal.trim();
      if (!key) continue;

      if (key.includes("ชื่อลูกค้า")) a.customer_name = val;
      else if (key.includes("เงินเดือน") || key.includes("รายได้"))
        a.monthly_income = Number(val);
      else if (key.includes("วงเงิน") || key.includes("ยอดกู้"))
        a.loan_amount = Number(val);
      else if (key.includes("ทรัพย์")) a.property_type = val;
      else if (key.includes("โครงการ")) a.project_name = val;
    }

    if (!a.customer_name) {
      await line.replyMessage(event.replyToken, {
        type: "text",
        text:
          "❌ ข้อมูลไม่ครบ\n" +
          "ตัวอย่าง: #เปิดเคส ชื่อลูกค้า=นายสมชาย | เงินเดือน=85000 | วงเงิน=5000000"
      });
      return;
    }

    const now = new Date().toISOString();
    const id = genId();

    const newApp: Application = {
      id,
      created_at: now,
      partner_id: partner.id, 
       partner_name: partner?.name ?? "",
      bank_name: "KBank",
      customer_name: a.customer_name!,
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
      insertApplication(newApp);
    } catch (err) {
      console.error("DB error (insertApplication):", err);
      await line.replyMessage(event.replyToken, {
        type: "text",
        text: "❌ ระบบขัดข้อง ไม่สามารถบันทึกเคสได้ กรุณาลองใหม่อีกครั้ง"
      });
      return;
    }

    await line.replyMessage(event.replyToken, {
      type: "text",
      text:
        `✅ เปิดเคสใหม่แล้ว\n` +
        `เลขเคส: ${id}\n` +
        `ชื่อลูกค้า: ${a.customer_name}\n` +
        `เงินเดือน: ${baht(a.monthly_income)}\n` +
        `ยอดกู้: ${baht(a.loan_amount)}\n` +
        `โครงการ: ${a.project_name}`
    });
    return;
  }

  // --------------------------------------------------
  //  เช็คเคส
  // --------------------------------------------------
  const CMD_CHECK = ["#เช็คเคส", "#สถานะ", "#เช็คสถานะ"];
  if (CMD_CHECK.some((p) => lower.startsWith(p.toLowerCase()))) {
    const query = text.replace(/^#เช็คเคส|^#สถานะ|^#เช็คสถานะ/i, "").trim();
    if (!query) {
      await line.replyMessage(event.replyToken, {
        type: "text",
        text: "กรุณาระบุเลขเคส หรือชื่อลูกค้า"
      });
      return;
    }

    let app: Application | undefined;
    try {
      app = findApplication(query);
    } catch (err) {
      console.error("DB error (findApplication):", err);
      await line.replyMessage(event.replyToken, {
        type: "text",
        text: "❌ ระบบขัดข้อง ไม่สามารถค้นหาเคสได้ กรุณาลองใหม่อีกครั้ง"
      });
      return;
    }

    if (!app) {
      await line.replyMessage(event.replyToken, {
        type: "text",
        text: `❌ ไม่พบเคส "${query}"`
      });
      return;
    }

    const ltvText = app.ltv ? ` (LTV ${app.ltv})` : "";
    await line.replyMessage(event.replyToken, {
      type: "text",
      text:
        `📌 รายละเอียดเคส\n` +
        `เลขเคส: ${app.id}\n` +
        `ชื่อลูกค้า: ${app.customer_name}\n` +
        `เงินเดือน: ${baht(app.monthly_income)}\n` +
        `โครงการ: ${app.project_name}\n` +
        `ยอดกู้: ${baht(app.loan_amount)}${ltvText}\n` +
        `สถานะ: ${app.status}\n` +
        `เครดิตสกอร์: ${app.credit_score ?? "-"}`
    });
    return;
  }

  // --------------------------------------------------
  //  Default help
  // --------------------------------------------------
  await line.replyMessage(event.replyToken, {
    type: "text",
    text:
      "สวัสดีครับ ระบบสินเชื่อบ้าน\n\n" +
      "• เปิดเคสใหม่:\n" +
      "#เปิดเคส ชื่อลูกค้า=... | เงินเดือน=... | วงเงิน=...\n\n" +
      "• เช็คสถานะเคส:\n" +
      "#เช็คเคส เลขเคส"
  });
}

// --------------------------------------------------
//  ADMIN UPDATE (จาก backoffice)
// --------------------------------------------------
export async function handleAdminUpdate(body: UpdateStatusRequest) {
  const { id, status, credit_score, officer_name, collateral_value } = body;

  try {
    updateApplicationStatus(
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

  const app = findApplication(id);
  if (!app) return { ok: false };

  const pushText =
    `📢 อัปเดตเคส\n` +
    `เลขเคส: ${id}\n` +
    `สถานะ: ${status}\n` +
    `เครดิตสกอร์: ${credit_score ?? "-"}\n` +
    (officer_name ? `โดย: ${officer_name}` : "");

  // 🔹 ดึงทุก channel ที่เกี่ยวกับเคสนี้จาก logs
  const channels = getChannelsByCaseId(id);

  // ถ้าไม่เจออะไรเลย fallback เป็น partner เดิม
  if (!channels.length) {
    const partner = getPartnerById(app.partner_id);
    if (partner) {
      channels.push({
        channel_id: partner.channel_id,
        channel_type: partner.channel_type
      });
    }
  }

  for (const ch of channels) {
    await line.pushMessage(ch.channel_id, {
      type: "text",
      text: pushText
    });

    try {
      insertConversationLog({
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