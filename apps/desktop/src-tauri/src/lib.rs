use std::{
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, RunEvent};

/// The IDE server (HTTP + WebSocket API and the built UI) listens here; see packages/ide-server.
const PORT: u16 = 7421;
const URL: &str = "http://127.0.0.1:7421/";
const START_TIMEOUT: Duration = Duration::from_secs(40);

/// The Node process the app started (none when a server was already running, or in development).
struct Server(Mutex<Option<Child>>);

fn port_open() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Tauri hands out `\\?\C:\…` paths on Windows, which Node does not like as a script path.
fn plain(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy().to_string();
    PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s))
}

#[cfg(windows)]
fn no_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn no_console(_cmd: &mut Command) {}

/// Starts the bundled Node runtime on the bundled ide-server, which also serves the UI.
fn spawn_server(app: &AppHandle) -> Result<Child, String> {
    let resources = app.path().resource_dir().map_err(|e| format!("resource folder: {e}"))?;
    let stage = plain(resources).join("stage");
    let node = stage.join("node").join(if cfg!(windows) { "node.exe" } else { "node" });
    let server = stage.join("server");
    let entry = server.join("dist").join("index.js");
    if !node.exists() || !entry.exists() {
        return Err(format!(
            "The app files are incomplete: expected {} and {}",
            node.display(),
            entry.display()
        ));
    }
    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .current_dir(&server)
        .env("HARDKAS_IDE_STATIC", stage.join("ui"))
        .env("HARDKAS_IDE_PORT", PORT.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_console(&mut cmd);
    cmd.spawn().map_err(|e| format!("could not start {}: {e}", node.display()))
}

fn stop_server(app: &AppHandle) {
    let Some(state) = app.try_state::<Server>() else { return };
    let Some(mut child) = state.0.lock().ok().and_then(|mut g| g.take()) else { return };
    #[cfg(windows)]
    {
        // The server owns terminals and jobs: take the whole process tree down with it.
        let mut kill = Command::new("taskkill");
        kill.args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        no_console(&mut kill);
        let _ = kill.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(w) = app.get_webview_window("main") {
        thread::sleep(Duration::from_millis(600)); // let the splash page finish loading
        let text = serde_json::to_string(message).unwrap_or_else(|_| "\"error\"".into());
        let _ = w.eval(&format!(
            "document.getElementById('msg').textContent='The IDE server did not start';document.getElementById('bar').style.display='none';document.getElementById('err').textContent={text};"
        ));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            // Development (`tauri dev`): `pnpm dev` already runs Vite and the IDE server and the window loads Vite.
            if cfg!(debug_assertions) {
                return Ok(());
            }
            // Installed app: start the server (unless one is already answering) and move the window from the splash to the IDE.
            let handle = app.handle().clone();
            thread::spawn(move || {
                if !port_open() {
                    match spawn_server(&handle) {
                        Ok(child) => {
                            if let Ok(mut slot) = handle.state::<Server>().0.lock() {
                                *slot = Some(child);
                            }
                        }
                        Err(e) => return show_error(&handle, &e),
                    }
                }
                let started = Instant::now();
                while !port_open() {
                    if started.elapsed() > START_TIMEOUT {
                        return show_error(&handle, &format!("Nothing answered on {URL} after {} s.", START_TIMEOUT.as_secs()));
                    }
                    thread::sleep(Duration::from_millis(150));
                }
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.eval(&format!("window.location.replace('{URL}')"));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the HardKas IDE app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_server(handle);
        }
    });
}
