"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

export interface MobileSlipSummary {
  id: string;
  payroll_run_id: string;
  period_start: string;
  period_end: string;
  status: string;
  basic_salary: number;
  overtime_salary: number;
  gross_salary: number;
  total_allowances: number;
  total_deductions: number;
  bpjs_employee_total: number;
  pph21_amount: number;
  net_salary: number;
  created_at: string;
}

export interface MobileSlipDetail {
  id: string;
  payroll_run_id: string;
  period_start: string;
  period_end: string;
  status: string;
  id_karyawan: string;
  nama_karyawan: string;
  divisi: string;
  ptkp_status: string;
  total_regular_hours: number;
  total_overtime_hours: number;
  total_overtime_index: number;
  rate_per_hour: number;
  basic_salary: number;
  overtime_salary: number;
  gross_salary: number;
  total_allowances: number;
  total_deductions: number;
  bpjs_employee_total: number;
  bpjs_company_total: number;
  pph21_amount: number;
  net_salary: number;
  breakdown_snapshot: string;
  created_at: string;
}

export async function getMyPayrollSlips(
  idKaryawan: string,
): Promise<MobileSlipSummary[]> {
  if (isDesktopRuntime()) {
    return invokeDesktop<MobileSlipSummary[]>("mobile_get_my_payroll_slips", {
      idKaryawan,
    });
  }
  const response = await requestWebApi<{ data: MobileSlipSummary[] }>(
    "/api/payroll/my-slips",
    "POST",
    {
      idKaryawan,
    },
  );
  return response.data;
}

export async function getPayrollSlipDetail(
  payrollItemId: string,
): Promise<MobileSlipDetail> {
  if (isDesktopRuntime()) {
    return invokeDesktop<MobileSlipDetail>("mobile_get_payroll_slip_detail", {
      payrollItemId,
    });
  }
  const response = await requestWebApi<{ data: MobileSlipDetail }>(
    "/api/payroll/slip-detail",
    "POST",
    {
      payrollItemId,
    },
  );
  return response.data;
}
