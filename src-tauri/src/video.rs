//! Native video encoder, for the webviews without WebCodecs (WebKitGTK on Linux): the system's ffmpeg, fed the RGBA
//! frames of the export on its standard input (src/export/nativeEncoder.ts). Its arguments are fixed here; the only
//! path it writes is the file picked in the save dialog (checked against the fs scope, where the dialog plugin adds
//! it). The soundtrack, when the film has one, is handed over first as a WAV file in the temporary folder. MP4 is
//! encoded on the GPU when ffmpeg can (NVENC, VAAPI), on the processor otherwise (libx264). The overlay alone keeps
//! its alpha (WebM / VP9).

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;

/// Header of `video_frame` naming its session (the body is the frame itself).
const SESSION_HEADER: &str = "x-video-session";
const AUDIO_BITRATE: &str = "192k";
/// Last lines of ffmpeg's error output shown when it fails.
const ERROR_LINES: usize = 3;
/// Colours converted to BT.709 (see `ffmpeg_args`).
const COLOR_FILTER: &str = "scale=out_color_matrix=bt709";
/// VAAPI encodes GPU surfaces only: the frames are converted (BT.709, NV12), then uploaded to the device opened by
/// `VAAPI_DEVICE` (the render node of the first GPU).
const VAAPI_FILTER: &str = "scale=out_color_matrix=bt709,format=nv12,hwupload";
const VAAPI_DEVICE: [&str; 2] = ["-vaapi_device", "/dev/dri/renderD128"];
/// Longest wait for one encoder probe: a stuck driver must not hold the export back.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

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

/// Constant rate factor for each export quality (lower: sharper and larger), on the scale of libx264 or libvpx-vp9
/// (also NVENC's `-cq` and VAAPI's `-qp`, see `h264_args`).
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

/// H.264 encoders of MP4, tried in this order: NVIDIA (NVENC), Intel / AMD (VAAPI), then the processor (libx264).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum H264 {
    Nvenc,
    Vaapi,
    X264,
}

impl H264 {
    fn name(self) -> &'static str {
        match self {
            H264::Nvenc => "h264_nvenc",
            H264::Vaapi => "h264_vaapi",
            H264::X264 => "libx264",
        }
    }
}

fn os(items: &[&str]) -> Vec<OsString> {
    items.iter().map(OsString::from).collect()
}

/// Video codec options of `encoder` at constant quality `crf`. NVENC's `-cq` (VBR without a target bitrate) and
/// VAAPI's fixed `-qp` take the crf of libx264 as is: same 0-51 scale, approximate equivalents (neither adapts like
/// crf; the size may differ).
fn h264_args(encoder: H264, crf: &str) -> Vec<OsString> {
    let codec = encoder.name();
    match encoder {
        H264::Nvenc => os(&["-c:v", codec, "-preset", "p5", "-rc", "vbr", "-cq", crf, "-b:v", "0", "-pix_fmt", "yuv420p"]),
        H264::Vaapi => os(&["-c:v", codec, "-rc_mode", "CQP", "-qp", crf]),
        H264::X264 => os(&["-c:v", codec, "-preset", "medium", "-crf", crf, "-pix_fmt", "yuv420p"]),
    }
}

/// Arguments of ffmpeg: raw RGBA frames on stdin, the optional WAV soundtrack, MP4 / H.264 (+ AAC) by `encoder` at
/// `output`, or WebM / VP9 (+ Opus) when its name ends in `.webm` or the film is `transparent` (`encoder` unused).
/// Colours converted and tagged as BT.709, what players assume for HD video.
#[allow(clippy::too_many_arguments)]
fn ffmpeg_args(width: u32, height: u32, fps: u32, crf: u8, encoder: H264, transparent: bool, sound: Option<&Path>, output: &Path) -> Vec<OsString> {
    let (size, fps, crf) = (format!("{width}x{height}"), fps.to_string(), crf.to_string());
    let webm = transparent || is_webm(output);
    let vaapi = !webm && encoder == H264::Vaapi;
    let mut args = os(&["-hide_banner", "-loglevel", "error", "-nostats"]);
    if vaapi {
        args.extend(os(&VAAPI_DEVICE));
    }
    args.extend(os(&["-f", "rawvideo", "-pix_fmt", "rgba", "-s", &size, "-r", &fps, "-i", "-"]));
    if let Some(sound) = sound {
        args.extend([OsString::from("-i"), sound.into()]);
    }
    if webm {
        // constant quality (-b:v 0); "good" with cpu-used 4 and row threads: a few times slower than x264, not dozens
        args.extend(os(&["-c:v", "libvpx-vp9", "-crf", &crf, "-b:v", "0", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1"]));
        args.extend(os(&["-pix_fmt", if transparent { "yuva420p" } else { "yuv420p" }]));
    } else {
        args.extend(h264_args(encoder, &crf));
    }
    args.extend(os(&["-vf", if vaapi { VAAPI_FILTER } else { COLOR_FILTER }, "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]));
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

/// Arguments of the probe of `encoder`: a tenth of a second of black, encoded as in an export, written nowhere.
fn probe_args(encoder: H264) -> Vec<OsString> {
    let vaapi = encoder == H264::Vaapi;
    let mut args = os(&["-hide_banner", "-loglevel", "error", "-nostats"]);
    if vaapi {
        args.extend(os(&VAAPI_DEVICE));
    }
    args.extend(os(&["-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1"]));
    args.extend(h264_args(encoder, "23"));
    args.extend(os(&["-vf", if vaapi { VAAPI_FILTER } else { COLOR_FILTER }, "-f", "null", "-"]));
    args
}

/// True when ffmpeg encodes with `encoder` here within `PROBE_TIMEOUT`: built with NVENC or VAAPI is not enough, the
/// GPU and its driver must answer.
fn probe(encoder: H264) -> bool {
    let spawned = Command::new("ffmpeg")
        .args(probe_args(encoder))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut ffmpeg) = spawned else { return false };
    let deadline = Instant::now() + PROBE_TIMEOUT;
    while Instant::now() < deadline {
        match ffmpeg.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => break,
        }
    }
    let _ = ffmpeg.kill();
    let _ = ffmpeg.wait();
    false
}

/// The first H.264 encoder that works on this machine, probed once per run (libx264 is not probed: it is what MP4
/// used before, and its failure is reported by the export itself).
fn h264_encoder() -> H264 {
    static ENCODER: OnceLock<H264> = OnceLock::new();
    *ENCODER.get_or_init(|| {
        let encoder = [H264::Nvenc, H264::Vaapi].into_iter().find(|&e| probe(e)).unwrap_or(H264::X264);
        eprintln!("Encodeur H.264 de ffmpeg : {}", encoder.name());
        encoder
    })
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
#[allow(clippy::too_many_arguments)]
fn start(app: &AppHandle, output: PathBuf, width: u32, height: u32, fps: u32, quality: &str, encoder: H264, transparent: bool, sound: Option<PathBuf>) -> Result<Session, String> {
    let crf = crf(quality, transparent || is_webm(&output)).ok_or(format!("Qualité inconnue : {quality}"))?;
    if !output.is_absolute() || !app.fs_scope().is_allowed(&output) {
        return Err("Ce fichier n'a pas été choisi dans la fenêtre « Enregistrer ».".into());
    }
    let mut ffmpeg = Command::new("ffmpeg")
        .args(ffmpeg_args(width, height, fps, crf, encoder, transparent, sound.as_deref(), &output))
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

/// Start ffmpeg writing `path` (picked in the save dialog) and return the id of the session; `transparent`: the overlay
/// alone, with its alpha.
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
    transparent: bool,
    sound: Option<u32>,
) -> Result<u32, String> {
    // before the lock: the first MP4 export probes the GPU (WebM is always encoded on the processor)
    let encoder = if transparent || is_webm(&path) { H264::X264 } else { h264_encoder() };
    let mut videos = lock(&videos);
    let sound = match sound {
        Some(id) => Some(videos.sounds.remove(&id).ok_or("Son du film introuvable.")?),
        None => None,
    };
    match start(&app, path, width, height, fps, &quality, encoder, transparent, sound.clone()) {
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
        let args = text(&ffmpeg_args(1920, 1080, 30, 20, H264::X264, false, None, Path::new("/films/Tour.mp4")));
        assert!(args.contains("-f rawvideo -pix_fmt rgba -s 1920x1080 -r 30 -i - -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p"));
        assert!(args.contains("-pix_fmt yuv420p -vf scale=out_color_matrix=bt709 -colorspace bt709"));
        assert!(args.ends_with("-movflags +faststart -f mp4 -y /films/Tour.mp4"));
        assert!(!args.contains("-c:a"));
        assert!(!args.contains("vaapi"));
    }

    #[test]
    fn encodes_on_an_nvidia_gpu_at_constant_quality() {
        let args = text(&ffmpeg_args(1920, 1080, 30, 20, H264::Nvenc, false, None, Path::new("/films/Tour.mp4")));
        assert!(args.starts_with("-hide_banner -loglevel error -nostats -f rawvideo"));
        assert!(args.contains("-i - -c:v h264_nvenc -preset p5 -rc vbr -cq 20 -b:v 0 -pix_fmt yuv420p -vf scale=out_color_matrix=bt709 -colorspace"));
        assert!(args.ends_with("-movflags +faststart -f mp4 -y /films/Tour.mp4"));
    }

    #[test]
    fn uploads_the_frames_to_the_vaapi_device() {
        let args = text(&ffmpeg_args(1920, 1080, 30, 17, H264::Vaapi, false, Some(Path::new("/tmp/s.wav")), Path::new("/films/Tour.mp4")));
        assert!(args.starts_with("-hide_banner -loglevel error -nostats -vaapi_device /dev/dri/renderD128 -f rawvideo"));
        assert!(args.contains("-i /tmp/s.wav -c:v h264_vaapi -rc_mode CQP -qp 17 -vf scale=out_color_matrix=bt709,format=nv12,hwupload -colorspace bt709"));
        assert!(!args.contains("yuv420p"));
        assert!(args.ends_with("-c:a aac -b:a 192k -movflags +faststart -f mp4 -y /films/Tour.mp4"));
    }

    #[test]
    fn probes_an_encoder_on_a_short_black_clip_written_nowhere() {
        let args = text(&probe_args(H264::Nvenc));
        assert!(args.contains("-f lavfi -i color=c=black:s=256x256:d=0.1 -c:v h264_nvenc"));
        assert!(args.ends_with("-vf scale=out_color_matrix=bt709 -f null -"));
        let args = text(&probe_args(H264::Vaapi));
        assert!(args.contains("-vaapi_device /dev/dri/renderD128 -f lavfi"));
        assert!(args.ends_with("-c:v h264_vaapi -rc_mode CQP -qp 23 -vf scale=out_color_matrix=bt709,format=nv12,hwupload -f null -"));
    }

    #[test]
    fn adds_the_soundtrack_as_a_second_input() {
        let args = text(&ffmpeg_args(1080, 1920, 60, 17, H264::X264, false, Some(Path::new("/tmp/s.wav")), Path::new("/films/Tour.mp4")));
        assert!(args.contains("-i - -i /tmp/s.wav -c:v libx264"));
        assert!(args.contains("-c:a aac -b:a 192k -movflags"));
    }

    #[test]
    fn writes_vp9_and_opus_in_webm_when_the_name_ends_in_webm() {
        assert!(is_webm(Path::new("/films/Tour.WebM")));
        assert!(!is_webm(Path::new("/films/Tour.mp4")));
        let args = text(&ffmpeg_args(1920, 1080, 30, 31, H264::X264, false, Some(Path::new("/tmp/s.wav")), Path::new("/films/Tour.webm")));
        assert!(args.contains("-i /tmp/s.wav -c:v libvpx-vp9 -crf 31 -b:v 0"));
        assert!(args.contains("-c:a libopus -b:a 192k"));
        assert!(args.ends_with("-f webm -y /films/Tour.webm"));
        assert!(!args.contains("movflags"));
        // the H.264 encoder found on the machine does not change WebM
        for encoder in [H264::Nvenc, H264::Vaapi] {
            let other = text(&ffmpeg_args(1920, 1080, 30, 31, encoder, false, Some(Path::new("/tmp/s.wav")), Path::new("/films/Tour.webm")));
            assert_eq!(other, args);
        }
    }

    #[test]
    fn keeps_the_alpha_of_a_transparent_film_in_vp9_webm() {
        let args = text(&ffmpeg_args(1920, 1080, 30, 31, H264::Nvenc, true, None, Path::new("/films/Tour habillage.webm")));
        assert!(args.contains("-f rawvideo -pix_fmt rgba -s 1920x1080 -r 30 -i - -c:v libvpx-vp9 -crf 31 -b:v 0"));
        assert!(args.contains("-row-mt 1 -pix_fmt yuva420p -vf scale=out_color_matrix=bt709 -colorspace bt709"));
        assert!(args.ends_with("-f webm -y /films/Tour habillage.webm"));
        assert!(!args.contains("nvenc"));
        // WebM even when the name typed in the save dialog says otherwise: MP4 / H.264 has no alpha
        let renamed = text(&ffmpeg_args(1920, 1080, 30, 31, H264::X264, true, None, Path::new("/films/Tour.mp4")));
        assert!(renamed.contains("-c:v libvpx-vp9") && renamed.contains("-pix_fmt yuva420p"));
        assert!(renamed.ends_with("-f webm -y /films/Tour.mp4"));
        let opaque = text(&ffmpeg_args(1920, 1080, 30, 31, H264::X264, false, None, Path::new("/films/Tour.webm")));
        assert!(opaque.contains("-pix_fmt yuv420p") && !opaque.contains("yuva"));
    }

    #[test]
    fn keeps_the_last_error_lines() {
        assert_eq!(error_tail(b"a\n\nb\nc\nd\n"), "b ; c ; d");
        assert_eq!(error_tail(b""), "");
    }
}
