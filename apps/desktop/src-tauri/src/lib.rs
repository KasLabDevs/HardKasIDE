use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse},
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder,
};

/// The IDE server (HTTP + WebSocket API and the built UI) listens here; see packages/ide-server.
const PORT: u16 = 7421;
const URL: &str = "http://127.0.0.1:7421/";
const START_TIMEOUT: Duration = Duration::from_secs(40);
/// What `GET /api/info` of the IDE server names itself (packages/ide-server/src/index.ts).
const SERVER_NAME: &str = "hardkas-ide-server";

/// The Node process the app started (none when a server was already running, or in development).
struct Server(Mutex<Option<Child>>);

/// Who answers on PORT.
#[derive(Debug, PartialEq)]
enum Listener {
    /// Nothing accepts connections.
    Nothing,
    /// A HardKas IDE server of this app's version: safe to load (the page gets this window's IPC).
    Ide,
    /// Something else: another program, or a HardKas IDE server of another version. The reason says which.
    Other(String),
}

/// Reads the reply of `GET /api/info` and decides whether it comes from a HardKas IDE server of `version`.
fn identify(raw: &[u8], version: &str) -> Result<(), String> {
    let text = String::from_utf8_lossy(raw);
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return Err("it does not answer HTTP".into());
    };
    let status = head.lines().next().unwrap_or("");
    if status.split_whitespace().nth(1) != Some("200") {
        return Err(format!("/api/info answered \"{}\"", status.trim()));
    }
    if head.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    }) {
        return Err("/api/info answered in an unexpected format".into());
    }
    let info: serde_json::Value =
        serde_json::from_str(body.trim()).map_err(|_| "/api/info did not answer JSON".to_string())?;
    if info.get("name").and_then(|v| v.as_str()) != Some(SERVER_NAME) {
        return Err("it is not a HardKas IDE server".into());
    }
    match info.get("version").and_then(|v| v.as_str()) {
        Some(v) if v == version => Ok(()),
        Some(v) => Err(format!("it is HardKas IDE {v}; this app is {version}")),
        None => Err(format!("it is an older HardKas IDE; this app is {version}")),
    }
}

/// Connects to PORT and, when something accepts, asks it `GET /api/info`.
fn probe(version: &str) -> Listener {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        return Listener::Nothing;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    // HTTP/1.0: the reply comes whole (no chunked encoding) and the server closes the connection when done.
    let request = format!(
        "GET /api/info HTTP/1.0\r\nHost: 127.0.0.1:{PORT}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return Listener::Other("it does not answer HTTP".into());
    }
    let mut raw = Vec::new();
    let _ = (&mut stream).take(64 * 1024).read_to_end(&mut raw);
    match identify(&raw, version) {
        Ok(()) => Listener::Ide,
        Err(why) => Listener::Other(why),
    }
}

fn port_taken_message(why: &str) -> String {
    format!(
        "Port {PORT} is used by another program ({why}).\nClose that program, then start HardKas IDE again."
    )
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

/// What may load inside the IDE window: the IDE itself and its plugin pages (served on loopback names), the dev UI
/// and the splash page. Every other web link opens in the system browser instead: the window has no tabs, so a
/// `target="_blank"` link (Download installer, Release notes, docs) did nothing, and a plain link would replace the IDE.
fn stays_in_app(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "tauri.localhost")),
        _ => false,
    }
}

/// Only web pages and mail links are handed to the system; anything else (file:, custom schemes) is dropped.
fn opens_in_browser(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

#[cfg(windows)]
fn browser_command(url: &str) -> Command {
    // No shell: cmd's `start` would read `&` in a URL as a command separator.
    let mut cmd = Command::new("rundll32");
    cmd.args(["url.dll,FileProtocolHandler", url]);
    no_console(&mut cmd);
    cmd
}

#[cfg(target_os = "macos")]
fn browser_command(url: &str) -> Command {
    let mut cmd = Command::new("open");
    cmd.arg(url);
    cmd
}

#[cfg(all(unix, not(target_os = "macos")))]
fn browser_command(url: &str) -> Command {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(url);
    cmd
}

/// Hands a link to the default browser (or mail client). The URL is already parsed and normalised.
fn open_in_browser(url: &Url) {
    if opens_in_browser(url) {
        let _ = browser_command(url.as_str()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
    }
}

/// Where a page may navigate inside an IDE window (the main one and the views it detaches into their own windows).
fn navigation_filter(url: &Url) -> bool {
    if stays_in_app(url) {
        return true;
    }
    open_in_browser(url);
    false
}

static POPUPS: AtomicU32 = AtomicU32::new(0);

/// `window.open` from an IDE window. An in-app URL (a detached view) gets a window built here, with the same
/// navigation and new-window filters as the main window: the default popup WebView2/WebKit would create has none,
/// so a page in it could navigate anywhere. It shares the opener's environment through `window_features`. It is not
/// listed in any capability, so it has no IPC. Anything else opens in the system browser.
fn new_window(app: &AppHandle, url: Url, features: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    if !stays_in_app(&url) {
        open_in_browser(&url);
        return NewWindowResponse::Deny;
    }
    let label = format!("popup-{}", POPUPS.fetch_add(1, Ordering::Relaxed) + 1);
    let opener = app.clone();
    // The runtime navigates the new webview to `url` itself; it starts blank.
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::External("about:blank".parse().expect("about:blank")))
        .window_features(features)
        .title("HardKas IDE")
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_navigation(navigation_filter)
        .on_new_window(move |url, features| new_window(&opener, url, features))
        .build();
    match built {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => NewWindowResponse::Deny,
    }
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
            // The window is described in tauri.conf.json ("create": false) and built here so that links leaving the
            // IDE open in the system browser.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json has no \"main\" window")?;
            let opener = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_navigation(navigation_filter)
                .on_new_window(move |url, features| new_window(&opener, url, features))
                .build()?;

            // Development (`tauri dev`): `pnpm dev` already runs Vite and the IDE server and the window loads Vite.
            if cfg!(debug_assertions) {
                return Ok(());
            }
            // Installed app: start the server (unless one is already answering) and move the window from the splash to
            // the IDE. Whatever answers on the port gets this window's IPC, so it is loaded only when it is a HardKas IDE
            // server of this version; anything else leaves the splash with an error.
            let handle = app.handle().clone();
            let version = app.package_info().version.to_string();
            thread::spawn(move || {
                match probe(&version) {
                    Listener::Ide => {}
                    Listener::Other(why) => return show_error(&handle, &port_taken_message(&why)),
                    Listener::Nothing => {
                        match spawn_server(&handle) {
                            Ok(child) => {
                                if let Ok(mut slot) = handle.state::<Server>().0.lock() {
                                    *slot = Some(child);
                                }
                            }
                            Err(e) => return show_error(&handle, &e),
                        }
                        let started = Instant::now();
                        loop {
                            // A server that is still starting may refuse or cut a connection: only the last answer counts.
                            let last = probe(&version);
                            if last == Listener::Ide {
                                break;
                            }
                            if started.elapsed() > START_TIMEOUT {
                                let message = match last {
                                    Listener::Other(why) => port_taken_message(&why),
                                    _ => format!("Nothing answered on {URL} after {} s.", START_TIMEOUT.as_secs()),
                                };
                                return show_error(&handle, &message);
                            }
                            thread::sleep(Duration::from_millis(150));
                        }
                    }
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

#[cfg(test)]
mod tests {
    use super::{identify, opens_in_browser, port_taken_message, stays_in_app};
    use tauri::Url;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn reply(status: &str, body: &str) -> Vec<u8> {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len())
            .into_bytes()
    }

    #[test]
    fn a_hardkas_ide_server_of_this_version_is_loaded() {
        let ok = reply("200 OK", r#"{"name":"hardkas-ide-server","version":"0.3.0","port":7421}"#);
        assert_eq!(identify(&ok, "0.3.0"), Ok(()));
    }

    #[test]
    fn anything_else_on_the_port_is_refused() {
        let cases: [(Vec<u8>, &str); 8] = [
            (reply("200 OK", r#"{"name":"hardkas-ide-server","version":"0.2.0"}"#), "HardKas IDE 0.2.0"),
            (reply("200 OK", r#"{"name":"hardkas-ide-server","port":7421}"#), "older HardKas IDE"),
            (reply("200 OK", r#"{"name":"something-else","version":"0.3.0"}"#), "not a HardKas IDE"),
            (reply("200 OK", "<html>hello</html>"), "not answer JSON"),
            (reply("404 Not Found", "{}"), "404"),
            (b"SSH-2.0-OpenSSH_9.6\r\n".to_vec(), "not answer HTTP"),
            (Vec::new(), "not answer HTTP"),
            (
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{}\r\n0\r\n\r\n".to_vec(),
                "unexpected format",
            ),
        ];
        for (raw, why) in cases {
            let err = identify(&raw, "0.3.0").expect_err(why);
            assert!(err.contains(why), "{err} / {why}");
        }
    }

    #[test]
    fn the_port_message_names_the_port_and_the_reason() {
        let m = port_taken_message("it is not a HardKas IDE server");
        assert!(m.starts_with("Port 7421 is used by another program (it is not a HardKas IDE server)"), "{m}");
    }

    #[test]
    fn the_ide_its_plugins_and_the_splash_stay_in_the_window() {
        for s in [
            "http://127.0.0.1:7421/",
            "http://127.0.0.1:7421/?detachView=covenant",
            "http://localhost:5173/",
            "http://localhost:7421/plugins/x/index.html",
            "http://[::1]:7421/",
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "about:blank",
        ] {
            assert!(stays_in_app(&u(s)), "{s}");
        }
    }

    #[test]
    fn web_links_go_to_the_system_browser() {
        for s in [
            "https://github.com/KasLabDevs/HardKasIDE/releases/download/v0.3.0/HardKas.IDE_0.3.0_x64-setup.exe",
            "https://github.com/KasLabDevs/HardKasIDE/releases/tag/v0.3.0",
            "https://docs.kaspa.org/llms.txt",
            "http://example.com/a?b=1&c=2",
            "https://localhost.evil.example/",
            "https://127.0.0.1.evil.example/",
            "mailto:dev@example.com",
        ] {
            assert!(!stays_in_app(&u(s)), "{s}");
            assert!(opens_in_browser(&u(s)), "{s}");
        }
    }

    #[test]
    fn other_schemes_neither_load_nor_open() {
        for s in ["file:///C:/Windows/System32/calc.exe", "ms-settings:privacy", "javascript:alert(1)", "vscode://file/x"] {
            assert!(!stays_in_app(&u(s)), "{s}");
            assert!(!opens_in_browser(&u(s)), "{s}");
        }
    }
}
