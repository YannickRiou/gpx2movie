//! Native video encoder, for the webviews without WebCodecs (WebKitGTK on Linux): the system's ffmpeg, fed the RGBA
//! frames of the export on its standard input (src/export/nativeEncoder.ts). Its arguments are fixed here; the only
//! path it writes is the file picked in the save dialog (checked against the fs scope, where the dialog plugin adds
//! it). The soundtrack, when the film has one, is handed over first as a WAV file in the temporary folder.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::thread::JoinHandle;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;

/// Header of `video_frame` naming its session (the body is the frame itself).
const SESSION_HEADER: &str = "x-video-session";
const AUDIO_BITRATE: &str = "192k";
/// Last lines of ffmpeg's error output shown when it fails.
const ERROR_LINES: usize = 3;

/// Encodings in progress and soundtracks waiting for theirs, by id.
#[derive(Default)]
pub struct Videos {
    last_id: u32,
    sessions: HashMap<u32, Session>,
    sounds: HashMap<u32, PathBuf>,
}

pub type VideoState = Mutex<Videos>;

struct Session {
    ffmpeg: Child,
    input: ChildStdin,
    /// size of one RGBA frame
    frame_bytes: usize,
    output: PathBuf,
    sound: Option<PathBuf>,
    /// ffmpeg's error output, read as it comes: a full pipe would block it, and the frame writes with it
    errors: JoinHandle<Vec<u8>>,
}

impl Videos {
    fn new_id(&mut self) -> u32 {
        self.last_id += 1;
        self.last_id
    }

    /// Stop every encoding and remove its partial file and soundtrack (the app is closing).
    pub fn cancel_all(&mut self) {
        for (_, session) in self.sessions.drain() {
            let _ = session.end(false);
        }
        for (_, sound) in self.sounds.drain() {
            remove_sound(&Some(sound));
        }
    }
}

/// True when the name typed in the save dialog ends in `.webm`: VP9 + Opus in WebM, MP4 otherwise.
fn is_webm(output: &Path) -> bool {
    output.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("webm"))
}

/// Constant rate factor for each export quality (lower: sharper and larger), on the scale of libx264 or libvpx-vp9.
fn crf(quality: &str, webm: bool) -> Option<u8> {
    match (quality, webm) {
        ("standard", false) => Some(23),
        ("high", false) => Some(20),
        ("max", false) => Some(17),
        ("standard", true) => Some(34),
        ("high", true) => Some(31),
        ("max", true) => Some(26),
        _ => None,
    }
}

/// Arguments of ffmpeg: raw RGBA frames on stdin, the optional WAV soundtrack, MP4 / H.264 (+ AAC) at `output`, or
/// WebM / VP9 (+ Opus) when its name ends in `.webm`. Colours converted and tagged as BT.709, what players assume for
/// HD video.
fn ffmpeg_args(width: u32, height: u32, fps: u32, crf: u8, sound: Option<&Path>, output: &Path) -> Vec<OsString> {
    let os = |items: &[&str]| items.iter().map(OsString::from).collect::<Vec<_>>();
    let (size, fps, crf) = (format!("{width}x{height}"), fps.to_string(), crf.to_string());
    let webm = is_webm(output);
    let mut args = os(&["-hide_banner", "-loglevel", "error", "-nostats"]);
    args.extend(os(&["-f", "rawvideo", "-pix_fmt", "rgba", "-s", &size, "-r", &fps, "-i", "-"]));
    if let Some(sound) = sound {
        args.extend([OsString::from("-i"), sound.into()]);
    }
    if webm {
        // constant quality (-b:v 0); "good" with cpu-used 4 and row threads: a few times slower than x264, not dozens
        args.extend(os(&["-c:v", "libvpx-vp9", "-crf", &crf, "-b:v", "0", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1"]));
        args.extend(os(&["-pix_fmt", "yuv420p"]));
    } else {
        args.extend(os(&["-c:v", "libx264", "-preset", "medium", "-crf", &crf, "-pix_fmt", "yuv420p"]));
    }
    args.extend(os(&["-vf", "scale=out_color_matrix=bt709", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]));
    if sound.is_some() {
        args.extend(os(&["-c:a", if webm { "libopus" } else { "aac" }, "-b:a", AUDIO_BITRATE]));
    }
    if webm {
        args.extend(os(&["-f", "webm", "-y"]));
    } else {
        args.extend(os(&["-movflags", "+faststart", "-f", "mp4", "-y"]));
    }
    args.push(output.into());
    args
}

fn lock<'a>(videos: &'a State<'_, VideoState>) -> MutexGuard<'a, Videos> {
    // a panic while holding the lock leaves the sessions usable
    videos.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("Données binaires attendues.".into()),
    }
}

fn remove_sound(sound: &Option<PathBuf>) {
    if let Some(sound) = sound {
        let _ = fs::remove_file(sound);
    }
}

/// The last lines ffmpeg wrote on its error output.
fn error_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(ERROR_LINES)..].join(" ; ")
}

impl Session {
    /// Wait for ffmpeg (killed first unless `complete`); the file is kept only when it succeeded.
    fn end(self, complete: bool) -> Result<u64, String> {
        let Session { mut ffmpeg, input, output, sound, errors, .. } = self;
        // end of the frames: ffmpeg finishes the file
        drop(input);
        if !complete {
            let _ = ffmpeg.kill();
        }
        let result = ffmpeg.wait();
        let stderr = errors.join().unwrap_or_default();
        remove_sound(&sound);
        match result {
            Ok(status) if complete && status.success() => fs::metadata(&output).map(|m| m.len()).map_err(|e| e.to_string()),
            failed => {
                let _ = fs::remove_file(&output);
                Err(match failed {
                    Ok(_) if !stderr.is_empty() => format!("ffmpeg a échoué : {}", error_tail(&stderr)),
                    Ok(status) => format!("ffmpeg s'est arrêté ({status})."),
                    Err(error) => format!("ffmpeg ne répond plus : {error}"),
                })
            }
        }
    }
}

/// True when ffmpeg is installed (on the PATH) and runs.
#[tauri::command]
pub async fn video_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// Keep the soundtrack of the next encoding (a WAV file, as the raw body); its id goes to `video_open`.
#[tauri::command]
pub async fn video_sound(request: Request<'_>, videos: State<'_, VideoState>) -> Result<u32, String> {
    let wav = raw_body(&request)?;
    let mut videos = lock(&videos);
    let id = videos.new_id();
    let path = std::env::temp_dir().join(format!("openflyover-{}-{id}.wav", std::process::id()));
    fs::write(&path, wav).map_err(|e| format!("Impossible d'écrire le son du film : {e}"))?;
    videos.sounds.insert(id, path);
    Ok(id)
}

/// ffmpeg started on `output`, reading its frames from the pipe.
fn start(app: &AppHandle, output: PathBuf, width: u32, height: u32, fps: u32, quality: &str, sound: Option<PathBuf>) -> Result<Session, String> {
    let crf = crf(quality, is_webm(&output)).ok_or(format!("Qualité inconnue : {quality}"))?;
    if !output.is_absolute() || !app.fs_scope().is_allowed(&output) {
        return Err("Ce fichier n'a pas été choisi dans la fenêtre « Enregistrer ».".into());
    }
    let mut ffmpeg = Command::new("ffmpeg")
        .args(ffmpeg_args(width, height, fps, crf, sound.as_deref(), &output))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de lancer ffmpeg : {e}"))?;
    let input = ffmpeg.stdin.take().ok_or("Entrée de ffmpeg indisponible.")?;
    let mut stderr = ffmpeg.stderr.take().ok_or("Sortie d'erreur de ffmpeg indisponible.")?;
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
    let frame_bytes = width as usize * height as usize * 4;
    Ok(Session { ffmpeg, input, frame_bytes, output, sound, errors })
}

/// Start ffmpeg writing `path` (picked in the save dialog) and return the id of the session.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn video_open(
    app: AppHandle,
    videos: State<'_, VideoState>,
    path: PathBuf,
    width: u32,
    height: u32,
    fps: u32,
    quality: String,
    sound: Option<u32>,
) -> Result<u32, String> {
    let mut videos = lock(&videos);
    let sound = match sound {
        Some(id) => Some(videos.sounds.remove(&id).ok_or("Son du film introuvable.")?),
        None => None,
    };
    match start(&app, path, width, height, fps, &quality, sound.clone()) {
        Ok(session) => {
            let id = videos.new_id();
            videos.sessions.insert(id, session);
            Ok(id)
        }
        Err(error) => {
            remove_sound(&sound);
            Err(error)
        }
    }
}

/// Hand one RGBA frame (the raw body) to ffmpeg; answers once ffmpeg took it (back-pressure of the pipe).
#[tauri::command]
pub async fn video_frame(request: Request<'_>, videos: State<'_, VideoState>) -> Result<(), String> {
    let frame = raw_body(&request)?;
    let id: u32 = request
        .headers()
        .get(SESSION_HEADER)
        .and_then(|value| value.to_str().ok()?.parse().ok())
        .ok_or("Encodage vidéo non précisé.")?;
    let mut videos = lock(&videos);
    let session = videos.sessions.get_mut(&id).ok_or("Encodage vidéo introuvable.")?;
    if frame.len() != session.frame_bytes {
        return Err(format!("Image de {} octets au lieu de {}.", frame.len(), session.frame_bytes));
    }
    if session.input.write_all(frame).is_ok() {
        return Ok(());
    }
    // ffmpeg stopped: its error output says why
    let session = videos.sessions.remove(&id).expect("session just found");
    Err(session.end(false).expect_err("a killed ffmpeg never succeeds"))
}

/// Close the input, wait for ffmpeg to finish the file and return its size in bytes.
#[tauri::command]
pub async fn video_finish(videos: State<'_, VideoState>, id: u32) -> Result<u64, String> {
    let session = lock(&videos).sessions.remove(&id).ok_or("Encodage vidéo introuvable.")?;
    session.end(true)
}

/// Stop ffmpeg and remove the partial file; nothing to do for an encoding already ended.
#[tauri::command]
pub async fn video_cancel(videos: State<'_, VideoState>, id: u32) -> Result<(), String> {
    let session = lock(&videos).sessions.remove(&id);
    if let Some(session) = session {
        let _ = session.end(false);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(args: &[OsString]) -> String {
        args.iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn maps_each_quality_to_a_crf() {
        assert_eq!(crf("standard", false), Some(23));
        assert_eq!(crf("high", false), Some(20));
        assert_eq!(crf("max", false), Some(17));
        assert_eq!(crf("high", true), Some(31));
        assert_eq!(crf("best", false), None);
    }

    #[test]
    fn reads_rgba_frames_and_writes_an_h264_mp4() {
        let args = text(&ffmpeg_args(1920, 1080, 30, 20, None, Path::new("/films/Tour.mp4")));
        assert!(args.contains("-f rawvideo -pix_fmt rgba -s 1920x1080 -r 30 -i - -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p"));
        assert!(args.ends_with("-movflags +faststart -f mp4 -y /films/Tour.mp4"));
        assert!(!args.contains("-c:a"));
    }

    #[test]
    fn adds_the_soundtrack_as_a_second_input() {
        let args = text(&ffmpeg_args(1080, 1920, 60, 17, Some(Path::new("/tmp/s.wav")), Path::new("/films/Tour.mp4")));
        assert!(args.contains("-i - -i /tmp/s.wav -c:v libx264"));
        assert!(args.contains("-c:a aac -b:a 192k -movflags"));
    }

    #[test]
    fn writes_vp9_and_opus_in_webm_when_the_name_ends_in_webm() {
        assert!(is_webm(Path::new("/films/Tour.WebM")));
        assert!(!is_webm(Path::new("/films/Tour.mp4")));
        let args = text(&ffmpeg_args(1920, 1080, 30, 31, Some(Path::new("/tmp/s.wav")), Path::new("/films/Tour.webm")));
        assert!(args.contains("-i /tmp/s.wav -c:v libvpx-vp9 -crf 31 -b:v 0"));
        assert!(args.contains("-c:a libopus -b:a 192k"));
        assert!(args.ends_with("-f webm -y /films/Tour.webm"));
        assert!(!args.contains("movflags"));
    }

    #[test]
    fn keeps_the_last_error_lines() {
        assert_eq!(error_tail(b"a\n\nb\nc\nd\n"), "b ; c ; d");
        assert_eq!(error_tail(b""), "");
    }
}
