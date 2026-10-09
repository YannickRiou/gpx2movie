//! Batch rendering from the command line: `openflyover --rendu <dossier des traces> [--sortie <dossier>]
//! [--prereglage <nom>] [--formats 16:9@1080p,9:16@1080p]` opens the app, renders one film per track of the folder
//! (src/export/cliRender.ts, the « Un film par trace » of the export drawer), writes a report and quits with 0 when
//! every film was made, 1 otherwise, 2 on a bad command line. The two folders are added to the fs scope here, nothing
//! else.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;

/// What the command line asks for (paths made absolute, the output folder created).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CliRender {
    pub input: PathBuf,
    pub output: PathBuf,
    pub preset: Option<String>,
    pub formats: Vec<String>,
}

pub type CliState = Mutex<Option<CliRender>>;

pub const USAGE: &str = "Utilisation : openflyover --rendu <dossier des traces> [--sortie <dossier>] [--prereglage <nom>] [--formats 16:9@1080p,9:16@1080p]";

/// The request of `args` (without the program name); None without `--rendu`. The output folder defaults to the input one.
pub fn parse_cli(args: &[String]) -> Result<Option<CliRender>, String> {
    let mut input = None;
    let mut output = None;
    let mut preset = None;
    let mut formats = Vec::new();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().cloned().ok_or(format!("{name} attend une valeur. {USAGE}"));
        match arg.as_str() {
            "--rendu" => input = Some(PathBuf::from(value("--rendu")?)),
            "--sortie" => output = Some(PathBuf::from(value("--sortie")?)),
            "--prereglage" => preset = Some(value("--prereglage")?),
            "--formats" => formats = value("--formats")?.split(',').map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect(),
            // arguments added by the OS or a launcher (macOS -psn_…) are not ours
            other if other.starts_with("--") => return Err(format!("Option inconnue : {other}. {USAGE}")),
            _ => {}
        }
    }
    let Some(input) = input else {
        return if output.is_some() || preset.is_some() || !formats.is_empty() { Err(format!("--rendu manque. {USAGE}")) } else { Ok(None) };
    };
    let output = output.unwrap_or_else(|| input.clone());
    Ok(Some(CliRender { input, output, preset, formats }))
}

/// `request` with absolute paths: the input folder must exist, the output folder is created when missing.
pub fn prepare(request: CliRender) -> Result<CliRender, String> {
    let input = absolute(&request.input).map_err(|e| format!("Dossier des traces introuvable ({}) : {e}", request.input.display()))?;
    if !input.is_dir() {
        return Err(format!("{} n'est pas un dossier.", input.display()));
    }
    std::fs::create_dir_all(&request.output).map_err(|e| format!("Dossier de sortie impossible à créer ({}) : {e}", request.output.display()))?;
    let output = absolute(&request.output).map_err(|e| format!("Dossier de sortie illisible : {e}"))?;
    Ok(CliRender { input, output, ..request })
}

fn absolute(path: &Path) -> std::io::Result<PathBuf> {
    let full = std::fs::canonicalize(path)?;
    // canonicalize gives \\?\C:\… on Windows: the webview and the fs plugin expect C:\…
    Ok(PathBuf::from(full.to_string_lossy().trim_start_matches(r"\\?\")))
}

/// Release builds on Windows have no console (windows_subsystem): borrow the one of the calling terminal so the
/// messages and the exit code reach it. Standard handles that are redirected (`> file`) are kept.
#[cfg(windows)]
fn attach_parent_console() {
    use std::ffi::c_void;
    use std::fs::OpenOptions;
    use std::os::windows::io::IntoRawHandle;

    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
        fn GetStdHandle(std_handle: u32) -> *mut c_void;
        fn SetStdHandle(std_handle: u32, handle: *mut c_void) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    const STD_ERROR_HANDLE: u32 = -12i32 as u32;

    // SAFETY: plain kernel32 calls; the handles given to SetStdHandle stay open for the life of the process
    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return; // no parent console (started from the Explorer)
        }
        for id in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            let current = GetStdHandle(id);
            if current.is_null() || current as isize == -1 {
                if let Ok(console) = OpenOptions::new().write(true).open("CONOUT$") {
                    SetStdHandle(id, console.into_raw_handle());
                }
            }
        }
    }
}

/// Reads the command line once at startup; on a bad one, says why and quits with 2.
pub fn setup(app: &AppHandle) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    {
        if !args.is_empty() {
            attach_parent_console();
        }
    }
    let request = match parse_cli(&args).and_then(|r| r.map(prepare).transpose()) {
        Ok(request) => request,
        Err(message) => {
            eprintln!("{message}");
            app.exit(2);
            return;
        }
    };
    if let Some(r) = &request {
        let scope = app.fs_scope();
        if let Err(e) = scope.allow_directory(&r.input, false).and_then(|_| scope.allow_directory(&r.output, false)) {
            eprintln!("Dossiers non autorisés : {e}");
            app.exit(2);
            return;
        }
    }
    *app.state::<CliState>().lock().unwrap_or_else(|e| e.into_inner()) = request;
}

/// The batch asked on the command line, if any; handed over once (a second call, a reload, gets none).
#[tauri::command]
pub fn cli_render(state: State<'_, CliState>) -> Option<CliRender> {
    state.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Quit the app with `code` at the end of a batch asked on the command line (`message` printed first).
#[tauri::command]
pub fn cli_exit(app: AppHandle, code: i32, message: String) {
    if code == 0 {
        println!("{message}");
    } else {
        eprintln!("{message}");
    }
    app.exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn nothing_asked_without_rendu() {
        assert_eq!(parse_cli(&args(&[])), Ok(None));
        assert_eq!(parse_cli(&args(&["-psn_0_123"])), Ok(None));
    }

    #[test]
    fn reads_every_option_and_defaults_the_output_to_the_input() {
        let r = parse_cli(&args(&["--rendu", "traces", "--prereglage", "Montagne", "--formats", "16:9@1080p, 9:16@720p"])).unwrap().unwrap();
        assert_eq!(r.input, PathBuf::from("traces"));
        assert_eq!(r.output, PathBuf::from("traces"));
        assert_eq!(r.preset.as_deref(), Some("Montagne"));
        assert_eq!(r.formats, vec!["16:9@1080p", "9:16@720p"]);
        let r = parse_cli(&args(&["--sortie", "films", "--rendu", "traces"])).unwrap().unwrap();
        assert_eq!(r.output, PathBuf::from("films"));
    }

    #[test]
    fn refuses_unknown_options_missing_values_and_options_without_rendu() {
        assert!(parse_cli(&args(&["--rendu"])).unwrap_err().contains("--rendu attend une valeur"));
        assert!(parse_cli(&args(&["--rendu", "a", "--vite"])).unwrap_err().contains("Option inconnue"));
        assert!(parse_cli(&args(&["--sortie", "films"])).unwrap_err().contains("--rendu manque"));
    }

    #[test]
    fn prepares_absolute_paths_and_creates_the_output() {
        let base = std::env::temp_dir().join(format!("openflyover-cli-{}", std::process::id()));
        let input = base.join("traces");
        std::fs::create_dir_all(&input).unwrap();
        let request = CliRender { input: input.clone(), output: base.join("films"), preset: None, formats: vec![] };
        let ready = prepare(request).unwrap();
        assert!(ready.input.is_absolute() && ready.output.is_dir());
        let missing = CliRender { input: base.join("absent"), output: base.join("films"), preset: None, formats: vec![] };
        assert!(prepare(missing).unwrap_err().contains("introuvable"));
        std::fs::remove_dir_all(base).unwrap();
    }
}
