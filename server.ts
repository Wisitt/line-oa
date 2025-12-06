// server.ts
import "dotenv/config";
import { Elysia } from "elysia";
import { Client } from "@line/bot-sdk";

import {
  getPartnerByLine,
  insertPartner,
  findApplication,
  insertApplication,
  updateApplicationStatus,
  getPartnerById,
  getAllApplications,
  getApplicationById,
  insertConversationLog
} from "./src/db";
import type { Application, UpdateStatusRequest } from "./src/types";

// ---------- LINE CLIENT ----------
const line = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!
});

// ---------- HELPERS ----------

// แปลงตัวเลขเป็นรูปแบบเงิน
function formatBaht(num: number | null | undefined): string {
  if (num == null || isNaN(num)) return "-";
  return "฿" + Number(num).toLocaleString("th-TH");
}

// แปลงวันที่ ISO -> "1 ธ.ค. 66"
function formatThaiDate(dateStr: string | null | undefined): string {
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

// เลือก class สถานะให้ pill
function statusClass(status: string | null | undefined): string {
  const s = (status || "").trim();
  if (!s) return "status-pill status-default";
  if (s.includes("อนุมัติ") && !s.includes("ไม่"))
    return "status-pill status-success";
  if (s.includes("ไม่อนุมัติ")) return "status-pill status-danger";
  if (s.includes("รอเอกสาร")) return "status-pill status-warning";
  if (s.includes("รอประเมิน")) return "status-pill status-info";
  return "status-pill status-default";
}

function creditScoreClass(score: string | null | undefined): string {
  const n = Number(score);
  if (isNaN(n)) return "score-neutral";
  if (n >= 760) return "score-good"; // สีเขียว
  if (n >= 680) return "score-mid";  // สีฟ้า
  return "score-low";                // สีแดง
}

function ltvClass(ltv: string | null | undefined): string {
  if (!ltv) return "ltv-neutral";
  const num = parseFloat(String(ltv).replace("%", ""));
  if (isNaN(num)) return "ltv-neutral";
  return num >= 100 ? "ltv-high" : "ltv-neutral";
}

function genId(): string {
  const year = new Date().getFullYear();
  const rnd = ("0000" + Math.floor(Math.random() * 9999)).slice(-4);
  return `HL-${year}-${rnd}`;
}

function baht(n: number | null): string {
  if (!n) return "-";
  return "฿" + n.toLocaleString("th-TH");
}

function extractCaseId(text: string): string | null {
  const m = text.match(/HL-?\d{4,}/i); // จับ HL2025... หรือ HL-2025...
  return m ? m[0].replace(/-/g, "") : null; // จะเก็บแบบใส่/ไม่ใส่ - ก็ได้
}

const STATUS_KEYWORDS = [
  { word: "อนุมัติแล้ว", status: "อนุมัติแล้ว" },
  { word: "ไม่อนุมัติ", status: "ไม่อนุมัติ" },
  { word: "รอเอกสาร", status: "รอเอกสารเพิ่ม" },
  { word: "รอประเมิน", status: "รอประเมินราคา" },
  { word: "รอพิจารณา", status: "รอพิจารณา" }
];

function extractStatus(text: string): string | null {
  const t = text.toLowerCase();
  for (const s of STATUS_KEYWORDS) {
    if (t.includes(s.word)) return s.status;
  }
  return null;
}

function extractName(text: string): string | null {
  const m = text.match(/(คุณ|นาย|นางสาว|นาง)\s+([^\s]+)/);
  return m ? `${m[1]} ${m[2]}` : null;
}



// ---------- MAIN LINE EVENT HANDLER ----------
async function handleEvent(event: any) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text: string = event.message.text.trim();
  const userId: string = event.source.userId;


    const role: "partner" | "bank" = "partner";

  // 🔹 2) ลองดึง case_id ถ้ามี (จาก HL-xxxx)
  const caseId = extractCaseId(text); // ฟังก์ชันที่คุยกันในข้อความก่อนหน้า

  // 🔹 3) log ข้อความเข้าระบบ
  insertConversationLog({
    case_id: caseId,
    line_user_id: userId,
    role,
    direction: "incoming",
    channel: "line",
    message_text: text,
    raw_payload: event
  });


  
  try {
    const text: string = event.message.text.trim();
    const lower = text.toLowerCase();
    const userId: string = event.source.userId;

    // ensure partner
    let partner = getPartnerByLine(userId);
    if (!partner) {
      insertPartner(`partner-${Date.now()}`, userId);
      partner = getPartnerByLine(userId)!;
    }

    // -------- CREATE CASE --------
    const CMD_NEW = ["#เปิดเคส", "#สมัครกู้", "ลงทะเบียนกู้:"];

    if (CMD_NEW.some((p) => lower.startsWith(p.toLowerCase()))) {
      let cleaned = text;
      CMD_NEW.forEach((p) => {
        if (cleaned.toLowerCase().startsWith(p.toLowerCase())) {
          cleaned = cleaned.slice(p.length).trim();
        }
      });

      // เผื่อพิมพ์ติดกันแบบ "ชื่อลูกค้า=... เงินเดือน=75000 วงเงิน=..." ไม่มีเครื่องหมาย |
      cleaned = cleaned.replace(
        /(เงินเดือน|รายได้|วงเงิน|ยอดกู้|ทรัพย์|โครงการ)\s*=/g,
        "|$1="
      );

      // ตัดทิ้ง | ที่อาจขึ้นต้น
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
        const [rawKey, rawVal] = part.split("=");
        if (!rawVal) continue;

        const key = rawKey.trim();
        const val = rawVal.trim();

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
        partner_name: partner.name,
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

      insertApplication(newApp);

      await line.replyMessage(event.replyToken, {
        type: "text",
        text:
          `✅ เปิดเคสใหม่แล้ว\n` +
          `เลขเคส: ${id}\n` +
          `ชื่อลูกค้า: ${a.customer_name}\n` +
          `เงินเดือน: ${baht(a.monthly_income ?? null)}\n` +
          `ยอดกู้: ${baht(a.loan_amount ?? null)}\n` +
          `โครงการ: ${a.project_name}`
      });
      return;
    }

    // -------- CHECK CASE --------
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

      const app = findApplication(query);

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

    // -------- DEFAULT HELP --------
    await line.replyMessage(event.replyToken, {
      type: "text",
      text:
        "สวัสดีครับ ระบบสินเชื่อบ้าน\n\n" +
        "• เปิดเคสใหม่:\n" +
        "#เปิดเคส ชื่อลูกค้า=... | เงินเดือน=... | วงเงิน=...\n\n" +
        "• เช็คสถานะเคส:\n" +
        "#เช็คเคส เลขเคส"
    });
  } catch (err) {
    console.error("handleEvent error:", err);
    // อย่าปล่อยให้ error หลุดออกไปถึง webhook
  }
}


// ---------- ADMIN UPDATE ----------
async function handleAdminUpdate(body: UpdateStatusRequest) {
  const { id, status, credit_score, officer_name, collateral_value } = body;

  updateApplicationStatus(
    id,
    status,
    credit_score || null,
    officer_name || null,
    collateral_value ?? null
  );

  const app = findApplication(id);
  if (!app) return { ok: false };

  const partner = getPartnerById(app.partner_id);
if (partner) {
  const pushText =
    `📢 อัปเดตเคส\n` +
    `เลขเคส: ${id}\n` +
    `สถานะ: ${status}\n` +
    `เครดิตสกอร์: ${credit_score ?? "-"}\n` +
    (officer_name ? `โดย: ${officer_name}` : "");

  await line.pushMessage(partner.line_user_id, {
    type: "text",
    text: pushText
  });

  insertConversationLog({
    case_id: id,
    line_user_id: partner.line_user_id,
    role: "bot",
    direction: "outgoing",
    channel: "line",
    message_text: pushText,
    raw_payload: null
  });
}


  return { ok: true };
}


// ---------- ELYSIA APP ----------
const port = Number(process.env.PORT) || 3000;

const app = new Elysia()
  .get("/", () => "Loan Backoffice Elysia Server Running")
  .get("/admin/dashboard", ({ query }) => {
    const currentTab = (query.tab as string) || "all";

    let apps = getAllApplications();

    const normalizeGroup = (g: string | null) => g || "pending";

    if (currentTab === "pending") {
      apps = apps.filter((a) => normalizeGroup(a.status_group) === "pending");
    } else if (currentTab === "approved") {
      apps = apps.filter((a) => normalizeGroup(a.status_group) === "approved");
    } else if (currentTab === "rejected") {
      apps = apps.filter((a) => normalizeGroup(a.status_group) === "rejected");
    }

    const rows = apps
      .map((a) => {
        const createdAt = formatThaiDate(a.created_at);
        const monthlyIncome = formatBaht(a.monthly_income ?? null);
        const loanAmount = formatBaht(a.loan_amount ?? null);
        const creditScore = a.credit_score ?? "-";
        const scoreClass = creditScoreClass(a.credit_score);
        const statusText = a.status ?? "-";
        const statusCls = statusClass(a.status);
        const ltvText = a.ltv ? `LTV: ${a.ltv}` : "";
        const ltvCls = ltvClass(a.ltv);

        return `
        <tr class="loan-row">
          <td class="col-app">
            <div class="app-id">
              <a href="/admin/app/${a.id}" class="app-id-link">${a.id}</a>
            </div>
            <div class="app-date">${createdAt}</div>
          </td>
          <td class="col-customer">
            <div class="customer-name">${a.customer_name || "-"}</div>
            <div class="customer-income">เงินเดือน: ${monthlyIncome}</div>
          </td>
          <td class="col-property">
            <div class="property-main">${a.property_type || "-"}</div>
            <div class="property-sub">${a.project_name || ""}</div>
          </td>
          <td class="col-loan">
            <div class="loan-amount">${loanAmount}</div>
            <div class="loan-ltv ${ltvCls}">${ltvText}</div>
          </td>
          <td class="col-score">
            <span class="credit-score ${scoreClass}">${creditScore}</span>
          </td>
          <td class="col-status">
            <span class="${statusCls}">${statusText}</span>
            ${a.officer_name ? `<div class="status-by">โดย: ${a.officer_name}</div>` : ""}
          </td>
          <td class="col-actions">
            <a href="/admin/app/${a.id}" class="btn-sm">อัปเดต</a>
          </td>
        </tr>
        `;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>Loan Backoffice Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    body {
      font-family: "Prompt", "Sarabun", "Noto Sans Thai", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 24px;
      background: #f4f6fb;
      color: #23314a;
    }

    /* top bar */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .top-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 2px;
      color: #24324a;
    }
    .top-sub {
      font-size: 13px;
      color: #7b879b;
    }
    .top-badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #1d4ed8;
      font-weight: 600;
    }

    /* tabs */
    .tabs {
      display: flex;
      gap: 8px;
      margin: 10px 0 16px;
    }
    .tab {
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid #e5e7eb;
      background: #f9fafb;
      color: #7c8ba1;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tab-active {
      background: #2563eb;
      color: #ffffff;
      border-color: #2563eb;
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.15);
    }

    .table-wrapper {
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    thead { background: #f1f5f9; }
    th, td {
      padding: 14px 16px;
      font-size: 14px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    th {
      text-align: left;
      font-weight: 600;
      color: #7c8ba1;
      font-size: 13px;
      letter-spacing: 0.01em;
    }
    tr:last-child td { border-bottom: none; }
    .loan-row { background: #ffffff; }

    .app-id-link {
      color: #2377eb;
      font-weight: 700;
      text-decoration: none;
      letter-spacing: 0.01em;
    }
    .app-id-link:hover { text-decoration: underline; }
    .app-date {
      font-size: 12px;
      color: #9ca3af;
      margin-top: 2px;
    }

    .customer-name { font-weight: 700; margin-bottom: 2px; color: #273548; }
    .customer-income { font-size: 12px; color: #4b5563; }

    .property-main { font-weight: 600; margin-bottom: 2px; color: #273548; }
    .property-sub { font-size: 12px; color: #7c8ba1; }

    .loan-amount { font-weight: 700; color: #1f2937; }
    .loan-ltv { font-size: 12px; margin-top: 2px; }
    .ltv-neutral { color: #6b7280; }
    .ltv-high { color: #d93025; font-weight: 700; }

    .credit-score {
      font-weight: 700;
      font-size: 16px;
    }
    .score-good { color: #0aab43; }
    .score-mid  { color: #1d4ed8; }
    .score-low  { color: #e11d48; }
    .score-neutral { color: #94a3b8; }

    .status-pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
    }
    .status-success { background: #d7f5df; color: #16853c; }
    .status-warning { background: #ffe8a3; color: #9a6700; }
    .status-info    { background: #dbe7ff; color: #3b6cd6; }
    .status-danger  { background: #fdd7d7; color: #c53030; }
    .status-default { background: #e5e7eb; color: #4b5563; }

    .status-by {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
    }

    .col-actions {
      text-align: right;
      white-space: nowrap;
    }
    .btn-sm {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 999px;
      border: none;
      background: #2563eb;
      color: #ffffff;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      box-shadow: 0 8px 18px rgba(37, 99, 235, 0.18);
    }
    .btn-sm:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div>
      <div class="top-title">รายการคำขอสินเชื่อบ้าน</div>
      <div class="top-sub">เลือกแท็บด้านล่าง แล้วกดปุ่ม “อัปเดต” เพื่อเปลี่ยนสถานะและกรอก CREDIT SCORE / LTV</div>
    </div>
    <div class="top-badge">Admin view</div>
  </div>

  <div class="tabs">
    <a href="/admin/dashboard"
       class="tab ${currentTab === "all" ? "tab-active" : ""}">ทั้งหมด</a>
    <a href="/admin/dashboard?tab=pending"
       class="tab ${currentTab === "pending" ? "tab-active" : ""}">รอดำเนินการ</a>
    <a href="/admin/dashboard?tab=approved"
       class="tab ${currentTab === "approved" ? "tab-active" : ""}">อนุมัติแล้ว</a>
    <a href="/admin/dashboard?tab=rejected"
       class="tab ${currentTab === "rejected" ? "tab-active" : ""}">ไม่อนุมัติ</a>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>เลขที่ใบสมัคร / วันที่</th>
          <th>ผู้ยื่นกู้ / รายได้</th>
          <th>หลักทรัพย์ / โครงการ</th>
          <th>วงเงินขอกู้ (LTV)</th>
          <th>CREDIT SCORE</th>
          <th>สถานะ</th>
          <th style="width: 120px; text-align:right;">จัดการ</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="7">ยังไม่มีข้อมูลเคส</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  })


app
  .get("/admin/app/:id", ({ params }) => {
    const app = getApplicationById(params.id);

    if (!app) {
      return new Response("ไม่พบเคส", { status: 404 });
    }

    const createdAt = formatThaiDate(app.created_at);
    const monthlyIncome = formatBaht(app.monthly_income ?? null);
    const loanAmount = formatBaht(app.loan_amount ?? null);
    const ltvText = app.ltv || "-";
    const creditScore = app.credit_score ?? "";
    const statusText = app.status || "รอพิจารณา";
    const officerName = app.officer_name ?? "";
    const collateralValue = app.collateral_value ?? "";

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>อัปเดตเคส ${app.id}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 24px;
      background: #f5f7fb;
      color: #111827;
    }
    .card {
      max-width: 840px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      padding: 24px 28px;
      box-shadow: 0 8px 30px rgba(15, 23, 42, 0.06);
      border: 1px solid #e5e7eb;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 20px;
      margin: 0;
    }
    .case-id-chip {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #eff6ff;
      color: #1d4ed8;
      font-weight: 600;
    }
    .meta {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 16px;
    }

    .steps {
      display: flex;
      gap: 8px;
      margin-bottom: 18px;
      font-size: 12px;
    }
    .step {
      padding: 4px 10px;
      border-radius: 999px;
      background: #f3f4f6;
      color: #4b5563;
    }
    .step-active {
      background: #2563eb;
      color: #ffffff;
      font-weight: 600;
    }

    .row {
      display: flex;
      gap: 16px;
      margin-bottom: 14px;
    }
    .row > div {
      flex: 1;
    }
    .label {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .value {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
    }
    .value-sub {
      font-size: 13px;
      color: #4b5563;
      margin-top: 2px;
    }

    form {
      margin-top: 20px;
      border-top: 1px solid #e5e7eb;
      padding-top: 16px;
    }
    .field {
      margin-bottom: 14px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 4px;
    }
    input[type="text"],
    input[type="number"],
    select {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      font-size: 14px;
    }
    input[type="number"] {
      text-align: right;
    }
    .hint {
      font-size: 12px;
      color: #6b7280;
      margin-top: 2px;
    }
    .actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 18px;
    }
    .btn-primary {
      background: #16a34a;
      color: white;
      border: none;
      border-radius: 999px;
      padding: 8px 20px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary:hover {
      background: #15803d;
    }
    .link-back {
      font-size: 13px;
      color: #6b7280;
      text-decoration: none;
    }
    .link-back:hover {
      text-decoration: underline;
    }
    .pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: #e5e7eb;
      color: #374151;
    }
    .summary-box {
      margin-top: 8px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #f9fafb;
      font-size: 12px;
      color: #4b5563;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header-row">
      <h1>อัปเดตสถานะเคสินเชื่อบ้าน</h1>
      <div class="case-id-chip">เคส: ${app.id}</div>
    </div>
    <div class="meta">สร้างเมื่อ ${createdAt}</div>

    <div class="steps">
      <div class="step step-active">1. ตรวจข้อมูลลูกค้า</div>
      <div class="step step-active">2. กรอกผลอนุมัติ / ราคาประเมิน</div>
      <div class="step">3. บันทึก & แจ้ง Partner ทาง LINE</div>
    </div>

    <div class="row">
      <div>
        <div class="label">ผู้ยื่นกู้</div>
        <div class="value">${app.customer_name}</div>
        <div class="value-sub">เงินเดือน: ${monthlyIncome}</div>
      </div>
      <div>
        <div class="label">หลักทรัพย์ / โครงการ</div>
        <div class="value">${app.property_type || "-"}</div>
        <div class="value-sub">${app.project_name || ""}</div>
      </div>
    </div>

    <div class="row">
      <div>
        <div class="label">วงเงินขอกู้</div>
        <div class="value">${loanAmount}</div>
        <div class="value-sub">LTV ปัจจุบัน: ${ltvText}</div>
      </div>
      <div>
        <div class="label">สถานะปัจจุบัน</div>
        <div class="value">
          <span class="pill">${statusText}</span>
        </div>
        <div class="value-sub">โดย: ${officerName || "-"}</div>
      </div>
    </div>

    <form method="post" action="/admin/app/${app.id}">
      <div class="field">
        <label for="status">ผลการพิจารณา (สถานะใหม่)</label>
        <select id="status" name="status" required>
          <option value="รอพิจารณา"${statusText === "รอพิจารณา" ? " selected" : ""}>รอพิจารณา</option>
          <option value="รอเอกสารเพิ่ม"${statusText === "รอเอกสารเพิ่ม" ? " selected" : ""}>รอเอกสารเพิ่ม</option>
          <option value="รอประเมินราคา"${statusText === "รอประเมินราคา" ? " selected" : ""}>รอประเมินราคา</option>
          <option value="อนุมัติแล้ว"${statusText === "อนุมัติแล้ว" ? " selected" : ""}>อนุมัติแล้ว</option>
          <option value="ไม่อนุมัติ"${statusText === "ไม่อนุมัติ" ? " selected" : ""}>ไม่อนุมัติ</option>
        </select>
      </div>

      <div class="field">
        <label for="collateral_value">ราคาประเมินหลักทรัพย์ (บาท)</label>
        <input
          id="collateral_value"
          name="collateral_value"
          type="number"
          min="0"
          step="1000"
          value="${collateralValue || ""}"
        />
        <div class="hint">ใช้คำนวณ LTV = วงเงินขอกู้ / ราคาประเมิน (กรอกเมื่อมีผลประเมินแล้ว)</div>
      </div>

      <div class="row">
        <div class="field">
          <label for="credit_score">CREDIT SCORE</label>
          <input
            id="credit_score"
            name="credit_score"
            type="text"
            value="${creditScore}"
            placeholder="เช่น 780"
          />
        </div>
        <div class="field">
          <label for="officer_name">ชื่อเจ้าหน้าที่ธนาคาร (จะแสดงใน Dashboard และในข้อความ LINE)</label>
          <input
            id="officer_name"
            name="officer_name"
            type="text"
            value="${officerName}"
            placeholder="เช่น วิทาวี ส."
          />
        </div>
      </div>

      <div class="summary-box">
        เมื่อกด “บันทึก & แจ้ง Partner ทาง LINE” ระบบจะ:
        • บันทึกสถานะใหม่, CREDIT SCORE, ราคาประเมิน และ LTV ลงระบบ • ส่งข้อความแจ้งผลเคสไปยัง Partner ใน LINE อัตโนมัติ
      </div>

      <div class="actions">
        <a href="/admin/dashboard" class="link-back">← กลับหน้า Dashboard</a>
        <button type="submit" class="btn-primary">บันทึก & แจ้ง Partner ทาง LINE</button>
      </div>
    </form>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  })


  .post("/admin/app/:id", async ({ body, params }) => {
    const form = body as any;

    const payload: UpdateStatusRequest = {
      id: params.id,
      status: (form.status as string) || "รอพิจารณา",
      credit_score: form.credit_score ? String(form.credit_score) : undefined,
      officer_name: form.officer_name ? String(form.officer_name) : undefined,
      collateral_value: form.collateral_value
        ? Number(form.collateral_value)
        : undefined
    };

    await handleAdminUpdate(payload);

    // redirect กลับไปหน้า dashboard
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/dashboard" }
    });
  })

  
.post("/webhook", async ({ body }) => {
  try {
    const anyBody = body as any;
    console.log("WEBHOOK BODY:", JSON.stringify(anyBody, null, 2));

    const events = anyBody?.events ?? [];
    for (const ev of events) {
      try {
        await handleEvent(ev);
      } catch (err) {
        console.error("Error in single event:", err);
      }
    }

    // ไม่ว่าอะไรจะเกิดขึ้น ตอบ OK กลับให้ LINE เสมอ
    return "OK";
  } catch (err) {
    console.error("Webhook handler error:", err);
    return "OK"; // ยังตอบ 200 ให้ LINE
  }
})

  .post("/admin/update", async ({ body }) => {
    const result = await handleAdminUpdate(body as UpdateStatusRequest);
    return result;
  })
  .listen(port);

console.log(`🚀 Elysia server running on port ${port}`);
