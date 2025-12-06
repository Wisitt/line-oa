import { formatBaht, formatThaiDate, statusClass, creditScoreClass, ltvClass } from "../api/server.js";
import type { Application } from "./types";

export function renderDashboardHtml(apps: Application[], currentTab: string): string {
  const normalizeGroup = (g: string | null) => g || "pending";
  const filtered =
    currentTab === "pending"
      ? apps.filter((a) => normalizeGroup(a.status_group) === "pending")
      : currentTab === "approved"
      ? apps.filter((a) => normalizeGroup(a.status_group) === "approved")
      : currentTab === "rejected"
      ? apps.filter((a) => normalizeGroup(a.status_group) === "rejected")
      : apps;

  const mapped = filtered.map((a) => {
    const createdAt = formatThaiDate(a.created_at);
    const monthlyIncome = formatBaht(a.monthly_income);
    const loanAmount = formatBaht(a.loan_amount);
    const creditScore = a.credit_score ?? "-";
    const scoreClass = creditScoreClass(a.credit_score);
    const statusText = a.status ?? "-";
    const statusCls = statusClass(a.status);
    const ltvText = `LTV: ${a.ltv ?? "-"}`;
    const ltvCls = ltvClass(a.ltv);
    return { createdAt, monthlyIncome, loanAmount, creditScore, scoreClass, statusText, statusCls, ltvText, ltvCls, app: a };
  });

  const rows = mapped
    .map(
      ({ createdAt, monthlyIncome, loanAmount, creditScore, scoreClass, statusText, statusCls, ltvText, ltvCls, app }) => `
      <tr class="loan-row">
        <td class="col-app" data-label="เลขที่ใบสมัคร / วันที่">
          <div class="app-id">
            <a href="/admin/app/${app.id}" class="app-id-link">${app.id}</a>
          </div>
          <div class="app-date">${createdAt}</div>
        </td>
        <td class="col-customer" data-label="ผู้ยื่นกู้ / รายได้">
          <div class="customer-name">${app.customer_name || "-"}</div>
          <div class="customer-income">เงินเดือน: ${monthlyIncome}</div>
        </td>
        <td class="col-property" data-label="หลักทรัพย์ / โครงการ">
          <div class="property-main">${app.property_type || "-"}</div>
          <div class="property-sub">${app.project_name || ""}</div>
        </td>
        <td class="col-loan" data-label="วงเงินขอกู้ (LTV)">
          <div class="loan-amount">${loanAmount}</div>
          <div class="loan-ltv ${ltvCls}">${ltvText}</div>
        </td>
        <td class="col-score" data-label="CREDIT SCORE">
          <span class="credit-score ${scoreClass}">${creditScore}</span>
        </td>
        <td class="col-status" data-label="สถานะ">
          <span class="${statusCls}">${statusText}</span>
          ${app.officer_name ? `<div class="status-by">โดย: ${app.officer_name}</div>` : ""}
        </td>
        <td class="col-actions" data-label="จัดการ">
          <a href="/admin/app/${app.id}" class="btn-sm">อัปเดต</a>
        </td>
      </tr>
    `
    )
    .join("");

  const cards = mapped
    .map(
      ({ createdAt, monthlyIncome, loanAmount, creditScore, scoreClass, statusText, statusCls, ltvText, ltvCls, app }) => `
    <div class="card-mobile">
      <div class="card-row">
        <div class="card-id"><a href="/admin/app/${app.id}" class="app-id-link">${app.id}</a></div>
        <div class="card-date">${createdAt}</div>
      </div>
      <div class="card-row">
        <div>
          <div class="label-sm">ผู้ยื่นกู้</div>
          <div class="customer-name">${app.customer_name || "-"}</div>
          <div class="customer-income">เงินเดือน: ${monthlyIncome}</div>
        </div>
        <div class="${statusCls}">${statusText}</div>
      </div>
      <div class="card-row">
        <div>
          <div class="label-sm">หลักทรัพย์ / โครงการ</div>
          <div class="property-main">${app.property_type || "-"}</div>
          <div class="property-sub">${app.project_name || ""}</div>
        </div>
      </div>
      <div class="card-row">
        <div>
          <div class="label-sm">วงเงินขอกู้</div>
          <div class="loan-amount">${loanAmount}</div>
          <div class="loan-ltv ${ltvCls}">${ltvText}</div>
        </div>
        <div>
          <div class="label-sm">CREDIT SCORE</div>
          <div class="credit-score ${scoreClass}">${creditScore}</div>
          ${app.officer_name ? `<div class="status-by">โดย: ${app.officer_name}</div>` : ""}
        </div>
      </div>
      <div class="card-row actions-row">
        <a href="/admin/app/${app.id}" class="btn-sm btn-block">อัปเดต</a>
      </div>
    </div>
  `
    )
    .join("");

  return templateDashboard(rows, cards, currentTab);
}

export function renderAppHtml(application: Application): string {
  const createdAt = formatThaiDate(application.created_at);
  const monthlyIncome = formatBaht(application.monthly_income);
  const loanAmount = formatBaht(application.loan_amount);
  const ltvText = application.ltv || "-";
  const creditScore = application.credit_score ?? "";
  const statusText = application.status || "รอพิจารณา";
  const officerName = application.officer_name ?? "";
  const collateralValue = application.collateral_value ?? "";

  return templateApp(application, {
    createdAt,
    monthlyIncome,
    loanAmount,
    ltvText,
    creditScore,
    statusText,
    officerName,
    collateralValue
  });
}

// ---------- Templates ----------
function templateDashboard(rows: string, cards: string, currentTab: string): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>Loan Backoffice Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    body { font-family: "Prompt","Sarabun","Noto Sans Thai",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:24px; background:#f4f6fb; color:#23314a; }
    .top-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
    .top-title { font-size:20px; font-weight:700; margin-bottom:2px; color:#24324a; }
    .top-sub { font-size:13px; color:#7b879b; }
    .top-badge { font-size:12px; padding:4px 10px; border-radius:999px; background:#e0f2fe; color:#1d4ed8; font-weight:600; }
    .tabs { display:flex; gap:8px; margin:10px 0 16px; }
    .tab { padding:6px 14px; border-radius:999px; font-size:13px; font-weight:600; border:1px solid #e5e7eb; background:#f9fafb; color:#7c8ba1; text-decoration:none; display:inline-flex; align-items:center; gap:6px; }
    .tab-active { background:#2563eb; color:#fff; border-color:#2563eb; box-shadow:0 8px 20px rgba(37,99,235,0.15); }
    .table-wrapper { background:#fff; border-radius:12px; box-shadow:0 6px 18px rgba(15,23,42,0.06); overflow:hidden; border:1px solid #e2e8f0; }
    table { border-collapse:collapse; width:100%; }
    thead { background:#f1f5f9; }
    th,td { padding:14px 16px; font-size:14px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
    th { text-align:left; font-weight:600; color:#7c8ba1; font-size:13px; letter-spacing:0.01em; }
    tr:last-child td { border-bottom:none; }
    .loan-row { background:#fff; }
    .app-id-link { color:#2377eb; font-weight:700; text-decoration:none; letter-spacing:0.01em; }
    .app-id-link:hover { text-decoration:underline; }
    .app-date { font-size:12px; color:#9ca3af; margin-top:2px; }
    .customer-name { font-weight:700; margin-bottom:2px; color:#273548; }
    .customer-income { font-size:12px; color:#4b5563; }
    .property-main { font-weight:600; margin-bottom:2px; color:#273548; }
    .property-sub { font-size:12px; color:#7c8ba1; }
    .loan-amount { font-weight:700; color:#1f2937; }
    .loan-ltv { font-size:12px; margin-top:2px; }
    .ltv-neutral { color:#6b7280; }
    .ltv-high { color:#d93025; font-weight:700; }
    .credit-score { font-weight:700; font-size:16px; }
    .score-good { color:#0aab43; }
    .score-mid { color:#1d4ed8; }
    .score-low { color:#e11d48; }
    .score-neutral { color:#94a3b8; }
    .status-pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; }
    .status-success { background:#d7f5df; color:#16853c; }
    .status-warning { background:#ffe8a3; color:#9a6700; }
    .status-info { background:#dbe7ff; color:#3b6cd6; }
    .status-danger { background:#fdd7d7; color:#c53030; }
    .status-default { background:#e5e7eb; color:#4b5563; }
    .status-by { font-size:11px; color:#6b7280; margin-top:4px; }
    .col-actions { text-align:right; white-space:nowrap; }
    .btn-sm { display:inline-block; padding:6px 14px; border-radius:999px; border:none; background:#2563eb; color:#fff; font-size:13px; font-weight:700; text-decoration:none; cursor:pointer; box-shadow:0 8px 18px rgba(37,99,235,0.18); }
    .btn-sm:hover { background:#1d4ed8; }
    .mobile-cards { display:none; }
    .card-mobile { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; box-shadow:0 4px 12px rgba(15,23,42,0.05); display:flex; flex-direction:column; gap:8px; }
    .card-mobile.empty { text-align:center; color:#6b7280; font-size:14px; }
    .card-row { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
    .card-id { font-weight:700; color:#2377eb; }
    .card-date { font-size:12px; color:#9ca3af; }
    .label-sm { font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#7c8ba1; margin-bottom:4px; }
    .actions-row { justify-content:flex-end; }
    .btn-block { display:inline-block; width:auto; }
    .desktop-only { display:block; }
    @media (max-width: 960px) {
      body { padding:16px; }
      .desktop-only { display:none; }
      .mobile-cards { display:flex; flex-direction:column; gap:10px; }
    }
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
    <a href="/admin/dashboard" class="tab ${currentTab === "all" ? "tab-active" : ""}">ทั้งหมด</a>
    <a href="/admin/dashboard?tab=pending" class="tab ${currentTab === "pending" ? "tab-active" : ""}">รอดำเนินการ</a>
    <a href="/admin/dashboard?tab=approved" class="tab ${currentTab === "approved" ? "tab-active" : ""}">อนุมัติแล้ว</a>
    <a href="/admin/dashboard?tab=rejected" class="tab ${currentTab === "rejected" ? "tab-active" : ""}">ไม่อนุมัติ</a>
  </div>

  <div class="table-wrapper desktop-only">
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
      <tbody>${rows || '<tr><td colspan="7">ยังไม่มีข้อมูลเคส</td></tr>'}</tbody>
    </table>
  </div>

  <div class="mobile-cards mobile-only">
    ${cards || '<div class="card-mobile empty">ยังไม่มีข้อมูลเคส</div>'}
  </div>
</body>
</html>`;
}

function templateApp(
  application: Application,
  detail: {
    createdAt: string;
    monthlyIncome: string;
    loanAmount: string;
    ltvText: string;
    creditScore: string;
    statusText: string;
    officerName: string;
    collateralValue: number | string;
  }
): string {
  const { createdAt, monthlyIncome, loanAmount, ltvText, creditScore, statusText, officerName, collateralValue } = detail;
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>อัปเดตเคส ${application.id}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:24px; background:#f5f7fb; color:#111827; }
    .card { max-width:840px; margin:0 auto; background:#fff; border-radius:16px; padding:24px 28px; box-shadow:0 8px 30px rgba(15,23,42,0.06); border:1px solid #e5e7eb; }
    .header-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    h1 { font-size:20px; margin:0; }
    .case-id-chip { font-size:12px; padding:4px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-weight:600; }
    .meta { font-size:13px; color:#6b7280; margin-bottom:16px; }
    .steps { display:flex; gap:8px; margin-bottom:18px; font-size:12px; }
    .step { padding:4px 10px; border-radius:999px; background:#f3f4f6; color:#4b5563; }
    .step-active { background:#2563eb; color:#fff; font-weight:600; }
    .row { display:flex; gap:16px; margin-bottom:14px; }
    .row > div { flex:1; }
    .label { font-size:12px; color:#6b7280; margin-bottom:4px; text-transform:uppercase; letter-spacing:.06em; }
    .value { font-size:14px; font-weight:600; color:#111827; }
    .value-sub { font-size:13px; color:#4b5563; margin-top:2px; }
    form { margin-top:20px; border-top:1px solid #e5e7eb; padding-top:16px; }
    .field { margin-bottom:14px; }
    label { display:block; font-size:13px; font-weight:500; color:#374151; margin-bottom:4px; }
    input[type="text"], input[type="number"], select { width:100%; padding:8px 10px; border-radius:8px; border:1px solid #d1d5db; font-size:14px; }
    input[type="number"] { text-align:right; }
    .hint { font-size:12px; color:#6b7280; margin-top:2px; }
    .actions { display:flex; justify-content:space-between; align-items:center; margin-top:18px; }
    .btn-primary { background:#16a34a; color:white; border:none; border-radius:999px; padding:8px 20px; font-size:14px; font-weight:600; cursor:pointer; }
    .btn-primary:hover { background:#15803d; }
    .link-back { font-size:13px; color:#6b7280; text-decoration:none; }
    .link-back:hover { text-decoration:underline; }
    .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; background:#e5e7eb; color:#374151; }
    .summary-box { margin-top:8px; padding:10px 12px; border-radius:8px; background:#f9fafb; font-size:12px; color:#4b5563; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header-row">
      <h1>อัปเดตสถานะเคสินเชื่อบ้าน</h1>
      <div class="case-id-chip">เคส: ${application.id}</div>
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
        <div class="value">${application.customer_name}</div>
        <div class="value-sub">เงินเดือน: ${monthlyIncome}</div>
      </div>
      <div>
        <div class="label">หลักทรัพย์ / โครงการ</div>
        <div class="value">${application.property_type || "-"}</div>
        <div class="value-sub">${application.project_name || ""}</div>
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
        <div class="value"><span class="pill">${statusText}</span></div>
        <div class="value-sub">โดย: ${officerName || "-"}</div>
      </div>
    </div>

    <form method="post" action="/admin/app/${application.id}">
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
        <input id="collateral_value" name="collateral_value" type="number" min="0" step="1000" value="${collateralValue || ""}" />
        <div class="hint">ใช้คำนวณ LTV = วงเงินขอกู้ / ราคาประเมิน (กรอกเมื่อมีผลประเมินแล้ว)</div>
      </div>

      <div class="row">
        <div class="field">
          <label for="credit_score">CREDIT SCORE</label>
          <input id="credit_score" name="credit_score" type="text" value="${creditScore}" placeholder="เช่น 780" />
        </div>
        <div class="field">
          <label for="officer_name">ชื่อเจ้าหน้าที่ธนาคาร</label>
          <input id="officer_name" name="officer_name" type="text" value="${officerName}" placeholder="เช่น วิทาวี ส." />
        </div>
      </div>

      <div class="summary-box">
        เมื่อกด “บันทึก & แจ้ง Partner ทาง LINE” ระบบจะบันทึกสถานะใหม่ CREDIT SCORE ราคาประเมิน และ LTV แล้วแจ้ง Partner ทาง LINE อัตโนมัติ
      </div>

      <div class="actions">
        <a href="/admin/dashboard" class="link-back">← กลับหน้า Dashboard</a>
        <button type="submit" class="btn-primary">บันทึก & แจ้ง Partner ทาง LINE</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}
