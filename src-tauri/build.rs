/// Commands of the app itself (video.rs, cli.rs): each gets an `allow-…` permission, granted in capabilities/default.json.
const COMMANDS: &[&str] = &[
    "video_available",
    "video_sound",
    "video_open",
    "video_frame",
    "video_finish",
    "video_cancel",
    "cli_render",
    "cli_exit",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("échec de la préparation de la construction");
}
