use rusqlite::{params, Connection};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use super::config::MobileState;
use super::models::CommandError;
use super::storage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvertimeTierRule {
    #[serde(default)]
    pub id: String,
    pub rule_type: String,
    pub tier_order: i64,
    pub hour_start: f64,
    #[serde(default)]
    pub hour_end: Option<f64>,
    pub multiplier: f64,
    #[serde(default)]
    pub is_active: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollComponent {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub category: String,
    pub calc_type: String,
    pub default_value: f64,
    #[serde(default)]
    pub applies_to: String,
    #[serde(default)]
    pub is_active: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxRule {
    #[serde(default)]
    pub id: String,
    pub category: String,
    pub bracket_min: i64,
    #[serde(default)]
    pub bracket_max: Option<i64>,
    pub rate_percentage: f64,
    #[serde(default)]
    pub effective_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BpjsRule {
    #[serde(default)]
    pub id: String,
    pub component_code: String,
    pub component_name: String,
    pub rate_percentage: f64,
    #[serde(default)]
    pub wage_cap: Option<i64>,
    #[serde(default)]
    pub effective_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollRecapRow {
    pub id_karyawan: String,
    pub nama_karyawan: String,
    pub divisi: String,
    pub rate_per_hour: i64,
    pub ptkp_status: String,
    pub total_hadir: i64,
    pub total_terlambat_menit: i64,
    pub total_regular_hours: f64,
    pub total_overtime_hours: f64,
    pub total_overtime_index: f64,
    pub est_basic_salary: i64,
    pub est_overtime_salary: i64,
    pub est_gross_salary: i64,
    pub est_total_allowance: i64,
    pub est_total_deduction: i64,
    pub est_bpjs_employee: i64,
    pub est_pph21: i64,
    pub est_net_salary: i64,
}

pub struct PayrollCalculator;

impl PayrollCalculator {
    pub fn calculate_overtime_index(
        overtime_hours: Decimal,
        tiers: &[OvertimeTierRule],
    ) -> Decimal {
        if overtime_hours <= Decimal::ZERO || tiers.is_empty() {
            return Decimal::ZERO;
        }

        let mut remaining = overtime_hours;
        let mut total_index = Decimal::ZERO;

        for tier in tiers {
            if tier.is_active == 0 {
                continue;
            }
            if remaining <= Decimal::ZERO {
                break;
            }

            let start = Decimal::from_f64_retain(tier.hour_start).unwrap_or(Decimal::ZERO);
            let multiplier = Decimal::from_f64_retain(tier.multiplier).unwrap_or(Decimal::ONE);

            let span = match tier.hour_end {
                Some(end) => {
                    let end_dec = Decimal::from_f64_retain(end).unwrap_or(Decimal::ZERO);
                    if end_dec > start {
                        end_dec - start
                    } else {
                        Decimal::ZERO
                    }
                }
                None => remaining,
            };

            if span <= Decimal::ZERO {
                continue;
            }

            let hours_in_tier = remaining.min(span);
            total_index += hours_in_tier * multiplier;
            remaining -= hours_in_tier;
        }

        total_index.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
    }

    pub fn calculate_components(
        basic_salary: Decimal,
        components: &[PayrollComponent],
        id_karyawan: &str,
    ) -> (Decimal, Decimal, Vec<serde_json::Value>) {
        let mut total_allowance = Decimal::ZERO;
        let mut total_deduction = Decimal::ZERO;
        let mut breakdown = Vec::new();

        for comp in components {
            if comp.is_active == 0 {
                continue;
            }
            if comp.applies_to != "ALL" && comp.applies_to != id_karyawan {
                continue;
            }

            let default_val = Decimal::from_f64_retain(comp.default_value).unwrap_or(Decimal::ZERO);
            let nominal = if comp.calc_type == "PERCENTAGE" {
                (basic_salary * (default_val / Decimal::from(100)))
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
            } else {
                default_val.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
            };

            if comp.category == "ALLOWANCE" {
                total_allowance += nominal;
            } else {
                total_deduction += nominal;
            }

            breakdown.push(json!({
                "id": comp.id,
                "name": comp.name,
                "category": comp.category,
                "calc_type": comp.calc_type,
                "rate": comp.default_value,
                "nominal": nominal.to_i64().unwrap_or(0)
            }));
        }

        (total_allowance, total_deduction, breakdown)
    }

    pub fn calculate_bpjs(
        gross_salary: Decimal,
        bpjs_rules: &[BpjsRule],
    ) -> (Decimal, Decimal, Vec<serde_json::Value>) {
        let mut total_emp = Decimal::ZERO;
        let mut total_co = Decimal::ZERO;
        let mut breakdown = Vec::new();

        for rule in bpjs_rules {
            let basis = match rule.wage_cap {
                Some(cap) if cap > 0 => {
                    let cap_dec = Decimal::from(cap);
                    gross_salary.min(cap_dec)
                }
                _ => gross_salary,
            };

            let rate = Decimal::from_f64_retain(rule.rate_percentage).unwrap_or(Decimal::ZERO);
            let nominal = (basis * (rate / Decimal::from(100)))
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

            let is_employee = rule.component_code.ends_with("_EMP");
            if is_employee {
                total_emp += nominal;
            } else {
                total_co += nominal;
            }

            breakdown.push(json!({
                "code": rule.component_code,
                "name": rule.component_name,
                "rate": rule.rate_percentage,
                "wage_cap": rule.wage_cap,
                "nominal": nominal.to_i64().unwrap_or(0),
                "is_employee": is_employee
            }));
        }

        (total_emp, total_co, breakdown)
    }

    pub fn calculate_pph21_ter(
        gross_salary: Decimal,
        ptkp_status: &str,
        tax_rules: &[TaxRule],
    ) -> (Decimal, serde_json::Value) {
        let ter_category = match ptkp_status.trim().to_uppercase().as_str() {
            "TK/0" | "TK/1" | "K/0" => "TER_A",
            "TK/2" | "TK/3" | "K/1" | "K/2" => "TER_B",
            "K/3" => "TER_C",
            _ => "TER_A",
        };

        let gross_i64 = gross_salary.to_i64().unwrap_or(0);

        let matching_rule = tax_rules.iter().find(|rule| {
            if rule.category != ter_category {
                return false;
            }
            let min_ok = gross_i64 >= rule.bracket_min;
            let max_ok = match rule.bracket_max {
                Some(max) => gross_i64 <= max,
                None => true,
            };
            min_ok && max_ok
        });

        if let Some(rule) = matching_rule {
            let rate = Decimal::from_f64_retain(rule.rate_percentage).unwrap_or(Decimal::ZERO);
            let pph21 = (gross_salary * (rate / Decimal::from(100)))
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

            (
                pph21,
                json!({
                    "method": "TER",
                    "category": ter_category,
                    "ptkp_status": ptkp_status,
                    "rate_percentage": rule.rate_percentage,
                    "pph21_amount": pph21.to_i64().unwrap_or(0)
                }),
            )
        } else {
            (
                Decimal::ZERO,
                json!({
                    "method": "TER",
                    "category": ter_category,
                    "ptkp_status": ptkp_status,
                    "rate_percentage": 0.0,
                    "pph21_amount": 0
                }),
            )
        }
    }
}

fn load_overtime_tiers(conn: &Connection, rule_type: &str) -> Result<Vec<OvertimeTierRule>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, rule_type, tier_order, hour_start, hour_end, multiplier, is_active
            FROM overtime_tier_rules
            WHERE rule_type = ?1 AND is_active = 1
            ORDER BY tier_order ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map(params![rule_type], |row| {
            Ok(OvertimeTierRule {
                id: row.get(0)?,
                rule_type: row.get(1)?,
                tier_order: row.get(2)?,
                hour_start: row.get(3)?,
                hour_end: row.get(4)?,
                multiplier: row.get(5)?,
                is_active: row.get(6)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(tier) = item {
            list.push(tier);
        }
    }
    Ok(list)
}

fn load_payroll_components(conn: &Connection) -> Result<Vec<PayrollComponent>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, name, category, calc_type, default_value, applies_to, is_active
            FROM payroll_components
            WHERE is_active = 1
            ORDER BY category, name ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PayrollComponent {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                calc_type: row.get(3)?,
                default_value: row.get(4)?,
                applies_to: row.get(5)?,
                is_active: row.get(6)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(comp) = item {
            list.push(comp);
        }
    }
    Ok(list)
}

fn load_tax_rules(conn: &Connection) -> Result<Vec<TaxRule>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, category, bracket_min, bracket_max, rate_percentage, effective_date
            FROM tax_rules
            ORDER BY category, bracket_min ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TaxRule {
                id: row.get(0)?,
                category: row.get(1)?,
                bracket_min: row.get(2)?,
                bracket_max: row.get(3)?,
                rate_percentage: row.get(4)?,
                effective_date: row.get(5)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(rule) = item {
            list.push(rule);
        }
    }
    Ok(list)
}

fn load_bpjs_rules(conn: &Connection) -> Result<Vec<BpjsRule>, CommandError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, component_code, component_name, rate_percentage, wage_cap, effective_date
            FROM bpjs_rules
            ORDER BY component_code ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(BpjsRule {
                id: row.get(0)?,
                component_code: row.get(1)?,
                component_name: row.get(2)?,
                rate_percentage: row.get(3)?,
                wage_cap: row.get(4)?,
                effective_date: row.get(5)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(rule) = item {
            list.push(rule);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn mobile_get_payroll_recap(
    state: State<'_, MobileState>,
    period_start: String,
    period_end: String,
) -> Result<Vec<PayrollRecapRow>, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    let overtime_tiers = load_overtime_tiers(&conn, "HARI_KERJA")?;
    let components = load_payroll_components(&conn)?;
    let tax_rules = load_tax_rules(&conn)?;
    let bpjs_rules = load_bpjs_rules(&conn)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT 
                md.id_unik,
                md.nama,
                md.divisi,
                COALESCE(sc.rate_per_hour, 0) AS rate_per_hour,
                COALESCE(sc.ptkp_status, 'TK/0') AS ptkp_status,
                COUNT(CASE WHEN ah.status_kehadiran IN ('Hadir', 'PRESENT') THEN 1 END) AS total_hadir,
                COALESCE(SUM(ah.menit_terlambat), 0) AS total_terlambat_menit,
                COALESCE(SUM(ah.jam_kerja), 0) AS total_jam_kerja_menit,
                COALESCE(SUM(ah.lembur), 0) AS total_lembur_menit
            FROM master_data md
            LEFT JOIN salary_configs sc ON sc.id_karyawan = md.id_unik
                AND sc.effective_date = (
                    SELECT MAX(effective_date) FROM salary_configs
                    WHERE id_karyawan = md.id_unik AND effective_date <= ?2
                )
            LEFT JOIN absensi_harian ah ON ah.id_karyawan = md.id_unik
                AND ah.tanggal >= ?1 AND ah.tanggal <= ?2
            WHERE md.status_aktif = 'Aktif'
            GROUP BY md.id_unik
            ORDER BY md.nama ASC;
            "#,
        )
        .map_err(|_| CommandError::internal())?;

    struct TempAgg {
        id_unik: String,
        nama: String,
        divisi: String,
        rate_per_hour: i64,
        ptkp_status: String,
        total_hadir: i64,
        total_terlambat: i64,
        jam_kerja_menit: i64,
        lembur_menit: i64,
    }

    let rows = stmt
        .query_map(params![period_start, period_end], |row| {
            Ok(TempAgg {
                id_unik: row.get(0)?,
                nama: row.get(1)?,
                divisi: row.get(2)?,
                rate_per_hour: row.get(3)?,
                ptkp_status: row.get(4)?,
                total_hadir: row.get(5)?,
                total_terlambat: row.get(6)?,
                jam_kerja_menit: row.get(7)?,
                lembur_menit: row.get(8)?,
            })
        })
        .map_err(|_| CommandError::internal())?;

    let mut result = Vec::new();

    for item in rows {
        if let Ok(agg) = item {
            let reg_hours = Decimal::from(agg.jam_kerja_menit) / Decimal::from(60);
            let ot_hours = Decimal::from(agg.lembur_menit) / Decimal::from(60);
            let rate_dec = Decimal::from(agg.rate_per_hour);

            let ot_index = PayrollCalculator::calculate_overtime_index(ot_hours, &overtime_tiers);
            let basic_salary = (reg_hours * rate_dec)
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);
            let overtime_salary = (ot_index * rate_dec)
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

            let (allowance, deduction, _) =
                PayrollCalculator::calculate_components(basic_salary, &components, &agg.id_unik);

            let gross = basic_salary + overtime_salary + allowance;
            let (bpjs_emp, _, _) = PayrollCalculator::calculate_bpjs(gross, &bpjs_rules);
            let (pph21, _) =
                PayrollCalculator::calculate_pph21_ter(gross, &agg.ptkp_status, &tax_rules);

            let net = (gross - deduction - bpjs_emp - pph21).max(Decimal::ZERO);

            result.push(PayrollRecapRow {
                id_karyawan: agg.id_unik,
                nama_karyawan: agg.nama,
                divisi: agg.divisi,
                rate_per_hour: agg.rate_per_hour,
                ptkp_status: agg.ptkp_status,
                total_hadir: agg.total_hadir,
                total_terlambat_menit: agg.total_terlambat,
                total_regular_hours: reg_hours.to_f64().unwrap_or(0.0),
                total_overtime_hours: ot_hours.to_f64().unwrap_or(0.0),
                total_overtime_index: ot_index.to_f64().unwrap_or(0.0),
                est_basic_salary: basic_salary.to_i64().unwrap_or(0),
                est_overtime_salary: overtime_salary.to_i64().unwrap_or(0),
                est_gross_salary: gross.to_i64().unwrap_or(0),
                est_total_allowance: allowance.to_i64().unwrap_or(0),
                est_total_deduction: deduction.to_i64().unwrap_or(0),
                est_bpjs_employee: bpjs_emp.to_i64().unwrap_or(0),
                est_pph21: pph21.to_i64().unwrap_or(0),
                est_net_salary: net.to_i64().unwrap_or(0),
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn mobile_get_employee_payroll_estimate(
    state: State<'_, MobileState>,
    id_karyawan: String,
    period_start: String,
    period_end: String,
) -> Result<serde_json::Value, CommandError> {
    let conn = storage::database(&state.data_dir)?;

    let overtime_tiers = load_overtime_tiers(&conn, "HARI_KERJA")?;
    let components = load_payroll_components(&conn)?;
    let tax_rules = load_tax_rules(&conn)?;
    let bpjs_rules = load_bpjs_rules(&conn)?;

    let row_data = conn
        .query_row(
            r#"
            SELECT 
                md.id_unik,
                md.nama,
                md.divisi,
                COALESCE(sc.rate_per_hour, 0) AS rate_per_hour,
                COALESCE(sc.ptkp_status, 'TK/0') AS ptkp_status,
                COUNT(CASE WHEN ah.status_kehadiran IN ('Hadir', 'PRESENT') THEN 1 END) AS total_hadir,
                COALESCE(SUM(ah.menit_terlambat), 0) AS total_terlambat_menit,
                COALESCE(SUM(ah.jam_kerja), 0) AS total_jam_kerja_menit,
                COALESCE(SUM(ah.lembur), 0) AS total_lembur_menit
            FROM master_data md
            LEFT JOIN salary_configs sc ON sc.id_karyawan = md.id_unik
                AND sc.effective_date = (
                    SELECT MAX(effective_date) FROM salary_configs
                    WHERE id_karyawan = md.id_unik AND effective_date <= ?2
                )
            LEFT JOIN absensi_harian ah ON ah.id_karyawan = md.id_unik
                AND ah.tanggal >= ?1 AND ah.tanggal <= ?2
            WHERE md.id_unik = ?3
            GROUP BY md.id_unik;
            "#,
            params![period_start, period_end, id_karyawan],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            },
        )
        .map_err(|_| CommandError::new("NOT_FOUND", "Data karyawan tidak ditemukan."))?;

    let (
        emp_id,
        emp_nama,
        emp_divisi,
        rate_per_hour,
        ptkp_status,
        total_hadir,
        total_terlambat,
        jam_kerja_menit,
        lembur_menit,
    ) = row_data;

    let reg_hours = Decimal::from(jam_kerja_menit) / Decimal::from(60);
    let ot_hours = Decimal::from(lembur_menit) / Decimal::from(60);
    let rate_dec = Decimal::from(rate_per_hour);

    let ot_index = PayrollCalculator::calculate_overtime_index(ot_hours, &overtime_tiers);
    let basic_salary = (reg_hours * rate_dec)
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);
    let overtime_salary = (ot_index * rate_dec)
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);

    let (allowance, deduction, comp_breakdown) =
        PayrollCalculator::calculate_components(basic_salary, &components, &emp_id);

    let gross = basic_salary + overtime_salary + allowance;
    let (bpjs_emp, bpjs_co, bpjs_breakdown) = PayrollCalculator::calculate_bpjs(gross, &bpjs_rules);
    let (pph21, tax_breakdown) =
        PayrollCalculator::calculate_pph21_ter(gross, &ptkp_status, &tax_rules);

    let net = (gross - deduction - bpjs_emp - pph21).max(Decimal::ZERO);

    let snapshot = json!({
        "rate_per_hour": rate_per_hour,
        "regular_hours": reg_hours.to_f64().unwrap_or(0.0),
        "overtime_hours": ot_hours.to_f64().unwrap_or(0.0),
        "overtime_index": ot_index.to_f64().unwrap_or(0.0),
        "basic_salary": basic_salary.to_i64().unwrap_or(0),
        "overtime_salary": overtime_salary.to_i64().unwrap_or(0),
        "components": comp_breakdown,
        "bpjs": bpjs_breakdown,
        "tax": tax_breakdown,
        "calculated_at": storage::now_epoch_seconds()
    });

    Ok(json!({
        "id": format!("est-{}", emp_id),
        "id_karyawan": emp_id,
        "nama_karyawan": emp_nama,
        "divisi": emp_divisi,
        "ptkp_status": ptkp_status,
        "period_start": period_start,
        "period_end": period_end,
        "total_hadir": total_hadir,
        "total_terlambat_menit": total_terlambat,
        "total_regular_hours": reg_hours.to_f64().unwrap_or(0.0),
        "total_overtime_hours": ot_hours.to_f64().unwrap_or(0.0),
        "total_overtime_index": ot_index.to_f64().unwrap_or(0.0),
        "rate_per_hour": rate_per_hour,
        "basic_salary": basic_salary.to_i64().unwrap_or(0),
        "overtime_salary": overtime_salary.to_i64().unwrap_or(0),
        "gross_salary": gross.to_i64().unwrap_or(0),
        "total_allowances": allowance.to_i64().unwrap_or(0),
        "total_deductions": deduction.to_i64().unwrap_or(0),
        "bpjs_employee_total": bpjs_emp.to_i64().unwrap_or(0),
        "bpjs_company_total": bpjs_co.to_i64().unwrap_or(0),
        "pph21_amount": pph21.to_i64().unwrap_or(0),
        "net_salary": net.to_i64().unwrap_or(0),
        "breakdown_snapshot": snapshot.to_string(),
        "is_estimate": true
    }))
}

#[tauri::command]
pub async fn mobile_get_my_payroll_slips(
    state: State<'_, MobileState>,
    id_karyawan: String,
) -> Result<Vec<serde_json::Value>, CommandError> {
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
