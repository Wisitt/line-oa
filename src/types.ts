// src/types.ts

export interface Partner {
  id: number;
  name: string;
  channel_id: string;
  channel_type: "user" | "group" | "room";
}


// Model เคสกู้บ้านให้ใกล้เคียง loan back office จริง ๆ
export interface Application {
  id: string;                 // HL-2024-0859
  created_at: string;         // วันที่สมัคร (ISO string)

  partner_id: number;         // FK ไปตาราง partners
  partner_name: string | null;
  bank_name: string | null;   // เช่น "KBank"

  customer_name: string;
  monthly_income: number | null;

  property_type: string;      // บ้านเดี่ยว, ทาวน์โฮม, คอนโด
  project_name: string;       // สิริ เพลส บางนา, The Line พหลฯ

  loan_amount: number | null;       // วงเงินขอกู้
  collateral_value: number | null;  // ราคาประเมินหลักทรัพย์
  ltv: string | null;               // "91.6%" คำนวณจาก loan/collateral

  credit_score: string | null;      // 780, 650, ...
  status: string;                   // "รอเอกสารเพิ่ม", "รอประเมินราคา", ...
  status_group: string | null;      // "pending", "approved", "rejected" ฯลฯ
  last_status_updated: string | null;

  officer_name: string | null;      // เจ้าหน้าที่ธนาคาร
  updated_at: string;               // ISO ล่าสุดที่มีการแก้ไข
}

export interface UpdateStatusRequest {
  id: string;
  status: string;
  credit_score?: string;
  officer_name?: string;      // NEW
  collateral_value?: number;  // NEW (ราคาประเมินทรัพย์)
}

