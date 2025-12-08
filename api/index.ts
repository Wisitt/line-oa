import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleEvent, handleAdminUpdate } from "./server.js";
import { getAllApplications, getApplicationById } from "../src/db.js";
import { renderDashboardHtml, renderAppHtml } from "../src/render.js";
import type { UpdateStatusRequest } from "../src/types";
import { createServer, ServerResponse } from "http";

async function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function readJson<T = any>(req: VercelRequest): Promise<T | null> {
  try {
    const raw = await readRawBody(req);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") {
    res.writeHead(302, { Location: "/admin/dashboard" }).end();
    return;
  }

  // สำหรับ Verify webhook จาก LINE (GET /webhook)
  if (req.method === "GET" && path === "/webhook") {
    res.status(200).send("OK");
    return;
  }

  if (req.method === "GET" && path === "/admin/dashboard") {
    const tab = (url.searchParams.get("tab") as string) || "all";
    const html = renderDashboardHtml(getAllApplications(), tab);
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(html);
    return;
  }

  
  if (req.method === "POST" && path.startsWith("/admin/delete-case/")) {
  const id = decodeURIComponent(path.split("/").pop() || "");

  const { deleteApplicationById, deleteLogsByCaseId } = require("../src/db.js");

  // ลบข้อมูลหลัก
  deleteApplicationById(id);

  // ลบ log ที่เกี่ยวข้องทั้งหมด
  deleteLogsByCaseId(id);

  res.status(200).send(`Deleted case: ${id}`);
  return;
}


if (req.method === "POST" && path.startsWith("/admin/delete-partner/")) {
  const id = Number(path.split("/").pop() || "");

  const { deletePartnerById } = require("../src/db.js");

  deletePartnerById(id);

  res.status(200).send(`Deleted partner: ${id}`);
  return;
}



  if (req.method === "GET" && path.startsWith("/admin/app/")) {
    const id = decodeURIComponent(path.split("/").pop() || "");
    const application = getApplicationById(id);
    if (!application) {
      res.status(404).send("ไม่พบเคส");
      return;
    }
    const html = renderAppHtml(application);
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(html);
    return;
  }

  if (req.method === "POST" && path.startsWith("/admin/app/")) {
    const id = decodeURIComponent(path.split("/").pop() || "");
    const raw = await readRawBody(req);
    const form = new URLSearchParams(raw);
    const payload: UpdateStatusRequest = {
      id,
      status: form.get("status") || "รอพิจารณา",
      credit_score: form.get("credit_score") || undefined,
      officer_name: form.get("officer_name") || undefined,
      collateral_value: form.get("collateral_value")
        ? Number(form.get("collateral_value"))
        : undefined
    };
    await handleAdminUpdate(payload);
    res.writeHead(302, { Location: "/admin/dashboard" }).end();
    return;
  }

  if (req.method === "POST" && path === "/webhook") {
    const body = await readJson<any>(req);
    const events = body?.events ?? [];

    for (const ev of events) {
      try {
        await handleEvent(ev);
      } catch (err: any) {
        console.error("Error in single event:", err);
        const data = err?.originalError?.response?.data;
        if (data) {
          console.error("LINE API error body:", JSON.stringify(data, null, 2));
        }
      }
    }

    res.status(200).send("OK");
    return;
  }

  if (req.method === "POST" && path === "/admin/update") {
    const body = (await readJson<UpdateStatusRequest>(req)) || ({} as UpdateStatusRequest);
    const result = await handleAdminUpdate(body);
    res.status(200).json(result);
    return;
  }

  res.status(404).send("Not Found");
}


// ---------- Local dev server ----------
function enhanceResponse(res: ServerResponse): VercelResponse {
  const r = res as any as VercelResponse;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  r.json = (data: any) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
    return r;
  };
  r.send = (data: any) => {
    if (typeof data === "object" && !Buffer.isBuffer(data)) {
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    } else {
      res.end(data);
    }
    return r;
  };
  return r;
}



if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3000;
  createServer((req, res) => {
    handler(req as any, enhanceResponse(res));
  }).listen(port, () => {
    console.log(`✅ Local server running on http://localhost:${port}`);
  });
}
