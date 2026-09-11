//! Slip gaji untuk Mobile: dua command baca-saja atas tabel hasil sinkronisasi.
//!
//! Berkas ini DULU juga memuat `mobile_get_payroll_recap` dan
//! `mobile_get_employee_payroll_estimate` beserta salinan `PayrollCalculator`
//! sendiri — salinan yang tidak mengenal jam hari libur, sehingga estimasi di
//! HP berbeda dari batch yang dibuat Desktop. Sejak administrasi payroll
//! disalin ke `payroll_admin/` (modul Desktop apa adanya), rekap Mobile memakai
//! `desktop_get_payroll_recap` dari sana dan salinan itu dihapus: uang dihitung
//! di SATU tempat.
//!
//! Yang tersisa di sini hanya pembacaan slip yang sudah dibekukan batch, dalam
//! satu query — jalur Desktop di gateway memanggil satu command per batch.

use rusqlite::params;
use serde_json::json;
use tauri::State;

use super::commands::require_permission;
use super::config::MobileState;
use super::models::CommandError;
use super::storage;

/// Izin yang sama dengan area `payroll` di `access.ts` — gerbang halaman
/// `/payroll` Mobile. Kedua command di berkas ini membuka gaji karyawan MANA
/// PUN (id karyawannya dipilih di layar), jadi tanpa gerbang ini setiap sesi
/// yang sah — termasuk operator terminal pemindai — bisa membacanya lewat IPC
/// meski halamannya sendiri sudah menolak.
const PAYROLL_VIEW: &str = "payroll.view";

#[tauri::command]
pub async fn mobile_get_my_payroll_slips(
    state: State<'_, MobileState>,
    id_karyawan: String,
) -> Result<Vec<serde_json::Value>, CommandError> {
    require_permission(&state, PAYROLL_VIEW)?;
    let conn = storage::database(&state.data_dir)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                pi.id,
                pi.payroll_run_id,
                pr.period_start,
                pr.period_end,
                pr.status,
                pi.basic_salary,
                pi.overtime_salary,
                pi.gross_salary,
                pi.total_allowances,
                pi.total_deductions,
                pi.bpjs_employee_total,
                pi.pph21_amount,
                pi.net_salary,
                pi.created_at
            FROM payroll_items pi
            JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
            WHERE pi.id_karyawan = ?1
            ORDER BY pr.period_start DESC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map(params![id_karyawan], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "payroll_run_id": row.get::<_, String>(1)?,
                "period_start": row.get::<_, String>(2)?,
                "period_end": row.get::<_, String>(3)?,
                "status": row.get::<_, String>(4)?,
                "basic_salary": row.get::<_, i64>(5)?,
                "overtime_salary": row.get::<_, i64>(6)?,
                "gross_salary": row.get::<_, i64>(7)?,
                "total_allowances": row.get::<_, i64>(8)?,
                "total_deductions": row.get::<_, i64>(9)?,
                "bpjs_employee_total": row.get::<_, i64>(10)?,
                "pph21_amount": row.get::<_, i64>(11)?,
                "net_salary": row.get::<_, i64>(12)?,
                "created_at": row.get::<_, String>(13)?,
            }))
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(slip) = item {
            list.push(slip);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn mobile_get_payroll_slip_detail(
    state: State<'_, MobileState>,
    payroll_item_id: String,
) -> Result<serde_json::Value, CommandError> {
    require_permission(&state, PAYROLL_VIEW)?;
    let conn = storage::database(&state.data_dir)?;

    let slip = conn
        .query_row(
            r#"
            SELECT
                pi.id,
                pi.payroll_run_id,
                pr.period_start,
                pr.period_end,
                pr.status,
                pi.id_karyawan,
                pi.nama_karyawan,
                pi.divisi,
                pi.ptkp_status,
                pi.total_regular_hours,
                pi.total_overtime_hours,
                pi.total_overtime_index,
                COALESCE(pi.total_holiday_hours, 0),
                COALESCE(pi.total_holiday_overtime_index, 0),
                pi.rate_per_hour,
                pi.basic_salary,
                pi.overtime_salary,
                pi.gross_salary,
                pi.total_allowances,
                pi.total_deductions,
                pi.bpjs_employee_total,
                pi.bpjs_company_total,
                pi.pph21_amount,
                pi.net_salary,
                pi.breakdown_snapshot,
                pi.created_at
            FROM payroll_items pi
            JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
            WHERE pi.id = ?1;
            "#,
            params![payroll_item_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "payroll_run_id": row.get::<_, String>(1)?,
                    "period_start": row.get::<_, String>(2)?,
                    "period_end": row.get::<_, String>(3)?,
                    "status": row.get::<_, String>(4)?,
                    "id_karyawan": row.get::<_, String>(5)?,
                    "nama_karyawan": row.get::<_, String>(6)?,
                    "divisi": row.get::<_, String>(7)?,
                    "ptkp_status": row.get::<_, String>(8)?,
                    "total_regular_hours": row.get::<_, f64>(9)?,
                    "total_overtime_hours": row.get::<_, f64>(10)?,
                    "total_overtime_index": row.get::<_, f64>(11)?,
                    "total_holiday_hours": row.get::<_, f64>(12)?,
                    "total_holiday_overtime_index": row.get::<_, f64>(13)?,
                    "rate_per_hour": row.get::<_, i64>(14)?,
                    "basic_salary": row.get::<_, i64>(15)?,
                    "overtime_salary": row.get::<_, i64>(16)?,
                    "gross_salary": row.get::<_, i64>(17)?,
                    "total_allowances": row.get::<_, i64>(18)?,
                    "total_deductions": row.get::<_, i64>(19)?,
                    "bpjs_employee_total": row.get::<_, i64>(20)?,
                    "bpjs_company_total": row.get::<_, i64>(21)?,
                    "pph21_amount": row.get::<_, i64>(22)?,
                    "net_salary": row.get::<_, i64>(23)?,
                    "breakdown_snapshot": row.get::<_, String>(24)?,
                    "created_at": row.get::<_, String>(25)?,
                }))
            },
        )
        .map_err(|_| CommandError::new("NOT_FOUND", "Slip gaji tidak ditemukan."))?;

    Ok(slip)
}
