use std::process::{Command, Child};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder, CheckMenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Port the sidecar server runs on.
const DEFAULT_PORT: u16 = 3141;

/// State holding the sidecar child process so we can kill it on exit.
struct SidecarState(Mutex<Option<Child>>);

/// Wait for the VWork HTTP server to become ready by polling TCP.
fn wait_for_server(port: u16, timeout: Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(200);

    while start.elapsed() < timeout {
        if let Ok(stream) = std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_secs(1),
        ) {
            drop(stream);
            std::thread::sleep(Duration::from_millis(300));
            return Ok(());
        }
        std::thread::sleep(poll_interval);
    }

    Err(format!(
        "VWork server did not start within {}s",
        timeout.as_secs(),
    ))
}

/// Find the sidecar binary path. It lives next to the main executable.
fn find_sidecar() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Cannot find current exe: {}", e))?;
    let exe_dir = exe.parent().ok_or("Cannot find exe directory")?;

    // In the .app bundle: Contents/MacOS/vwork-server
    let sidecar = exe_dir.join("vwork-server");
    if sidecar.exists() {
        return Ok(sidecar);
    }

    // In dev: src-tauri/binaries/vwork-server-{triple}
    let target_triple = env!("TAURI_ENV_TARGET_TRIPLE");
    let dev_sidecar = exe_dir
        .join("../../binaries")
        .join(format!("vwork-server-{}", target_triple));
    if dev_sidecar.exists() {
        return Ok(dev_sidecar);
    }

    Err(format!(
        "Sidecar not found at {:?} or {:?}",
        sidecar, dev_sidecar
    ))
}

/// Spawn the VWork sidecar binary using std::process::Command.
fn spawn_sidecar() -> Result<Child, String> {
    let sidecar_path = find_sidecar()?;
    eprintln!("[vwork] Sidecar path: {:?}", sidecar_path);

    let child = Command::new(&sidecar_path)
        .args(["serve", "--port", &DEFAULT_PORT.to_string()])
        .stderr(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn {:?}: {}", sidecar_path, e))?;

    Ok(child)
}

/// Kill the sidecar process gracefully.
fn kill_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Build the system tray menu and icon.
fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItemBuilder::with_id("open", "Open VWork").build(app)?;
    let generate = MenuItemBuilder::with_id("generate_report", "Generate Report").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let autolaunch = CheckMenuItemBuilder::with_id("autolaunch", "Launch at Login")
        .build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit VWork").build(app)?;

    // Check current autostart state
    {
        let autostart = app.autolaunch();
        if let Ok(enabled) = autostart.is_enabled() {
            let _ = autolaunch.set_checked(enabled);
        }
    }

    let menu = MenuBuilder::new(app)
        .items(&[&open, &generate, &sep1, &autolaunch, &sep2, &quit])
        .build()?;

    let app_handle = app.clone();
    let app_handle2 = app.clone();

    TrayIconBuilder::new()
        .tooltip("VWork")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "open" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "generate_report" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        trigger_report(&app).await;
                    });
                }
                "autolaunch" => {
                    let autostart = app.autolaunch();
                    if let Ok(enabled) = autostart.is_enabled() {
                        if enabled {
                            let _ = autostart.disable();
                            let _ = autolaunch.set_checked(false);
                        } else {
                            let _ = autostart.enable();
                            let _ = autolaunch.set_checked(true);
                        }
                    }
                }
                "quit" => {
                    if let Some(state) = app.try_state::<SidecarState>() {
                        kill_sidecar(&state);
                    }
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(&app_handle)?;

    setup_native_menu(&app_handle2)?;

    Ok(())
}

/// Set up the native macOS menu bar (VWork, Edit, Window menus).
fn setup_native_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let about = PredefinedMenuItem::about(app, Some("About VWork"), None)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = PredefinedMenuItem::quit(app, Some("Quit VWork"))?;

    let app_menu = SubmenuBuilder::new(app, "VWork")
        .items(&[&about, &sep, &quit_item])
        .build()?;

    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .items(&[&undo, &redo, &PredefinedMenuItem::separator(app)?, &cut, &copy, &paste, &select_all])
        .build()?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let zoom = PredefinedMenuItem::fullscreen(app, Some("Zoom"))?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .items(&[&minimize, &zoom])
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;

    app.set_menu(menu)?;

    Ok(())
}

/// Trigger report generation via the sidecar's HTTP API and show a notification.
async fn trigger_report(app: &AppHandle) {
    let url = format!("http://127.0.0.1:{}/api/report/run", DEFAULT_PORT);

    let result: Result<(), String> = async {
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .body("{}")
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("Server returned {}", resp.status()))
        }
    }
    .await;

    match result {
        Ok(()) => {
            #[cfg(desktop)]
            {
                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title("VWork")
                    .body("Report generation started")
                    .show();
            }
        }
        Err(e) => {
            eprintln!("[vwork] Failed to trigger report: {}", e);
            #[cfg(desktop)]
            {
                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title("VWork")
                    .body(format!("Failed to generate report: {}", e))
                    .show();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // Spawn the VWork sidecar server
            eprintln!("[vwork] Starting sidecar on port {}...", DEFAULT_PORT);
            match spawn_sidecar() {
                Ok(child) => {
                    let state = handle.state::<SidecarState>();
                    *state.0.lock().unwrap() = Some(child);
                    eprintln!("[vwork] Sidecar spawned, waiting for server...");
                }
                Err(e) => {
                    eprintln!("[vwork] {}", e);
                }
            }

            // Wait for server in a background thread, then navigate the webview
            let handle2 = handle.clone();
            std::thread::spawn(move || {
                match wait_for_server(DEFAULT_PORT, Duration::from_secs(15)) {
                    Ok(()) => {
                        eprintln!("[vwork] Server is ready!");
                        if let Some(w) = handle2.get_webview_window("main") {
                            let url = format!("http://localhost:{}", DEFAULT_PORT);
                            let _ = w.navigate(url.parse().unwrap());
                        }
                    }
                    Err(e) => {
                        eprintln!("[vwork] {}", e);
                    }
                }
            });

            // Set up system tray
            setup_tray(&handle)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    kill_sidecar(&state);
                }
            }
        });
}
