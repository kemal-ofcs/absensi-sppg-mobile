use rusqlite::params;
use serde_json::json;
use tauri::State;

use super::config::MobileState;
use super::models::CommandError;
use super::storage;

fn require_permission(state: &MobileState, permission: &str) -> Result<(), CommandError> {
    let session = state.session.lock().map_err(|_| CommandError::internal())?;
    let session = session.as_ref().ok_or_else(|| {
        CommandError::new(
            "MOBILE_SESSION_MISSING",
            "Session Mobile tidak tersedia. Silakan login kembali.",
        )
    })?;
    if !session.operator.is_superadmin
        && !session
            .operator
            .permissions
            .iter()
            .any(|key| key == permission)
    {
        return Err(CommandError::new(
            "MOBILE_ACCESS_DENIED",
            "Akses ditolak untuk tindakan ini.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn mobile_get_my_payroll_slips(
    state: State<'_, MobileState>,
    id_karyawan: String,
) -> Result<Vec<serde_json::Value>, CommandError> {
    require_permission(&state, "payroll.view")?;
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
            WHERE pi.id_karyawan = ?1 AND pr.status = 'PAID'
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
    require_permission(&state, "payroll.view")?;
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
                    "rate_per_hour": row.get::<_, i64>(12)?,
                    "basic_salary": row.get::<_, i64>(13)?,
                    "overtime_salary": row.get::<_, i64>(14)?,
                    "gross_salary": row.get::<_, i64>(15)?,
                    "total_allowances": row.get::<_, i64>(16)?,
                    "total_deductions": row.get::<_, i64>(17)?,
                    "bpjs_employee_total": row.get::<_, i64>(18)?,
                    "bpjs_company_total": row.get::<_, i64>(19)?,
                    "pph21_amount": row.get::<_, i64>(20)?,
                    "net_salary": row.get::<_, i64>(21)?,
                    "breakdown_snapshot": row.get::<_, String>(22)?,
                    "created_at": row.get::<_, String>(23)?,
                }))
            },
        )
        .map_err(|_| CommandError::new("NOT_FOUND", "Slip gaji tidak ditemukan."))?;

    Ok(slip)
}
