use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder, CheckMenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// Port the sidecar server runs on.
const DEFAULT_PORT: u16 = 3141;

/// State holding the sidecar child process so we can kill it on exit.
struct SidecarState(Mutex<Option<CommandChild>>);

/// Wait for the VWork HTTP server to become ready by polling its config endpoint.
fn wait_for_server(port: u16, timeout: Duration) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/api/config", port);
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(200);

    while start.elapsed() < timeout {
        // Use a simple TCP connect check instead of full HTTP to avoid pulling in
        // a blocking HTTP client at this stage.
        if let Ok(stream) = std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_secs(1),
        ) {
            drop(stream);
            // Server is accepting connections — give it a moment to finish init
            std::thread::sleep(Duration::from_millis(300));
            return Ok(());
        }
        std::thread::sleep(poll_interval);
    }

    Err(format!(
        "VWork server did not start within {}s (tried {})",
        timeout.as_secs(),
        url
    ))
}

/// Spawn the VWork sidecar binary.
fn spawn_sidecar(app: &AppHandle) -> Result<CommandChild, String> {
    let shell = app.shell();
    let command = shell
        .sidecar("binaries/vwork-server")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["serve", "--port", &DEFAULT_PORT.to_string()]);

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Forward sidecar stderr to our stderr for debugging
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprint!("{}", text);
                }
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprint!("[sidecar stdout] {}", text);
                }
                CommandEvent::Error(err) => {
                    eprintln!("[sidecar error] {}", err);
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[sidecar] process exited: {:?}", status);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Kill the sidecar process gracefully.
fn kill_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
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
                    // Kill sidecar before quitting
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

    // Set up macOS native menu bar
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
    // Fire-and-forget POST to the sidecar
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
            match spawn_sidecar(&handle) {
                Ok(child) => {
                    // Store the child so we can kill it later
                    let state = handle.state::<SidecarState>();
                    *state.0.lock().unwrap() = Some(child);
                    eprintln!("[vwork] Sidecar spawned, waiting for server...");
                }
                Err(e) => {
                    eprintln!("[vwork] Failed to spawn sidecar: {}", e);
                    // Continue anyway — user can still use the app if server starts separately
                }
            }

            // Wait for server in a background thread, then load the URL
            let handle2 = handle.clone();
            std::thread::spawn(move || {
                match wait_for_server(DEFAULT_PORT, Duration::from_secs(15)) {
                    Ok(()) => {
                        eprintln!("[vwork] Server is ready!");
                        // Navigate the webview to the server URL
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
            // Hide window instead of closing on macOS (Cmd+W)
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
                // Kill sidecar on exit
                if let Some(state) = app.try_state::<SidecarState>() {
                    kill_sidecar(&state);
                }
            }
        });
}
