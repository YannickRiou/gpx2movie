//! Desktop shell of OpenFlyover: the web app (../dist) in a native window, with the dialog and fs plugins used by
//! src/platform/desktop.ts. No command of its own yet (native video encoder: see ARCHITECTURE.md, « Bureau »).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("échec du lancement d'OpenFlyover");
}
