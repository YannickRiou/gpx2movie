//! Desktop shell of OpenFlyover: the web app (../dist) in a native window, with the dialog and fs plugins used by
//! src/platform/desktop.ts, the oauth and opener plugins of the Strava connection (src/platform/oauthRedirect.ts), and
//! the native video encoder (system ffmpeg) for webviews without WebCodecs (video.rs).

mod video;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_opener::init())
        .manage(video::VideoState::default())
        .invoke_handler(tauri::generate_handler![
            video::video_available,
            video::video_sound,
            video::video_open,
            video::video_frame,
            video::video_finish,
            video::video_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("échec du lancement d'OpenFlyover")
        .run(|app, event| {
            // closed during an export: no ffmpeg left running, no partial film left on disk
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut videos) = app.state::<video::VideoState>().lock() {
                    videos.cancel_all();
                }
            }
        });
}
