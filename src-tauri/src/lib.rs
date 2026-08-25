mod mobile;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            app.manage(mobile::MobileState::initialize(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mobile::commands::desktop_get_session,
            mobile::commands::desktop_get_runtime_status,
            mobile::commands::desktop_get_bootstrap_status,
            mobile::commands::desktop_bootstrap_superadmin,
            mobile::commands::desktop_login,
            mobile::commands::desktop_logout,
            mobile::commands::desktop_get_master_operators,
            mobile::commands::desktop_create_operator,
            mobile::commands::desktop_update_operator,
            mobile::commands::desktop_delete_operator,
            mobile::commands::desktop_get_roles,
            mobile::commands::desktop_create_role,
            mobile::commands::desktop_update_role,
            mobile::commands::desktop_set_role_permissions,
            mobile::commands::desktop_delete_role,
            mobile::commands::desktop_get_employees,
            mobile::commands::desktop_create_employee,
            mobile::commands::desktop_import_employees,
            mobile::commands::desktop_update_employee,
            mobile::commands::desktop_set_employee_status,
            mobile::commands::desktop_generate_employee_tokens,
            mobile::commands::desktop_get_shifts,
            mobile::commands::desktop_create_shift,
            mobile::commands::desktop_update_shift,
            mobile::commands::desktop_delete_shift,
            mobile::commands::desktop_submit_qr_scan,
            mobile::commands::desktop_get_corrections,
            mobile::commands::desktop_create_correction,
            mobile::commands::desktop_delete_correction,
            mobile::commands::desktop_update_attendance,
            mobile::commands::desktop_delete_attendance,
            mobile::commands::desktop_delete_log_scan,
            mobile::commands::desktop_delete_import_offline,
            mobile::commands::desktop_get_backups,
            mobile::commands::desktop_create_backup,
            mobile::commands::desktop_cancel_backup,
            mobile::commands::desktop_get_imports,
            mobile::commands::desktop_import_offline,
            mobile::commands::desktop_get_dashboard_data,
            mobile::commands::desktop_get_id_cards,
            mobile::commands::desktop_update_id_card,
            mobile::commands::desktop_get_id_card_template,
            mobile::commands::desktop_save_id_card_template,
            mobile::commands::desktop_force_resync_settings,
            mobile::commands::desktop_debug_template_sync,
            mobile::commands::desktop_get_geofence_settings,
            mobile::commands::desktop_update_geofence_settings,
            mobile::commands::desktop_get_scanner_settings,
            mobile::commands::desktop_update_scanner_settings,
            mobile::commands::desktop_get_sync_status,
            mobile::commands::desktop_sync_now,
            mobile::commands::desktop_get_sync_conflicts,
            mobile::commands::desktop_retry_failed_sync,
            mobile::commands::desktop_resolve_sync_conflicts,
            mobile::commands::desktop_resolve_sync_conflicts_local,
            mobile::commands::desktop_clear_failed_sync,
            mobile::commands::desktop_save_file,
            mobile::commands::desktop_share_file,
            mobile::commands::desktop_get_holidays,
            mobile::commands::desktop_create_holiday,
            mobile::commands::desktop_update_holiday,
            mobile::commands::desktop_delete_holiday,
            mobile::commands::desktop_get_alfa_settings,
            mobile::commands::desktop_save_alfa_settings,
            mobile::commands::desktop_trigger_generate_alfa,
            mobile::commands::desktop_get_server_url,
            mobile::commands::desktop_set_server_url,
            mobile::commands::desktop_get_turso_url,
            mobile::commands::desktop_save_turso_config,
            mobile::commands::desktop_test_turso_connection,
            mobile::commands::desktop_clear_turso_config,
            mobile::commands::desktop_get_company_profile,
            mobile::commands::desktop_update_company_profile,
            mobile::payroll::mobile_get_my_payroll_slips,
            mobile::payroll::mobile_get_payroll_slip_detail,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("Aplikasi Mobile berhenti karena runtime Tauri gagal: {error}");
            std::process::exit(1);
        });
}
