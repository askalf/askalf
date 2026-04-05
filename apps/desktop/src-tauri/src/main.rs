// AskAlf Desktop — Tauri 2 Entry Point
//
// Manages the standalone AskAlf server lifecycle:
// 1. First run: setup screen collects API keys
// 2. Subsequent runs: auto-starts server, shows dashboard
// 3. System tray for background operation
// 4. Server health monitoring

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Child};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    anthropic_key: String,
    openai_key: String,
    port: u16,
    data_dir: String,
    installed: bool,
    oauth_connected: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            anthropic_key: String::new(),
            openai_key: String::new(),
            port: 3000,
            data_dir: default_data_dir(),
            installed: false,
            oauth_connected: false,
        }
    }
}

struct ServerState {
    child: Option<Child>,
    running: bool,
}

fn default_data_dir() -> String {
    if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA")
            .unwrap_or_else(|_| {
                let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
                format!("{}\\AppData\\Roaming", home)
            });
        format!("{}\\askalf", appdata)
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        format!("{}/Library/Application Support/askalf", home)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        format!("{}/.askalf", home)
    }
}

fn config_path() -> PathBuf {
    let dir = default_data_dir();
    PathBuf::from(&dir).join("desktop-config.json")
}

fn load_config() -> AppConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&data) {
                return config;
            }
        }
    }
    AppConfig::default()
}

fn save_config_to_disk(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    // Set restrictive permissions on config (contains API keys)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

#[tauri::command]
fn get_config() -> Result<AppConfig, String> {
    let config = load_config();
    if config.anthropic_key.is_empty() && !config.oauth_connected {
        return Err("No configuration found".into());
    }
    Ok(config)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    save_config_to_disk(&config)
}

/// Check if Claude Code is already authenticated via OAuth
#[tauri::command]
fn check_oauth() -> Result<bool, String> {
    // Check for existing Claude credentials file
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    let creds_path = PathBuf::from(&home).join(".claude").join(".credentials.json");

    if !creds_path.exists() {
        return Ok(false);
    }

    if let Ok(data) = fs::read_to_string(&creds_path) {
        if let Ok(creds) = serde_json::from_str::<serde_json::Value>(&data) {
            if let Some(oauth) = creds.get("claudeAiOauth") {
                let expires_at = oauth.get("expiresAt").and_then(|v| v.as_i64()).unwrap_or(0);
                let has_refresh = oauth.get("refreshToken").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
                // Valid if has refresh token (can renew even if expired)
                return Ok(has_refresh);
            }
        }
    }

    Ok(false)
}

/// Start Claude Code OAuth login flow
#[tauri::command]
async fn start_oauth_login(app: AppHandle) -> Result<(), String> {
    // Run `claude login` which opens a browser for OAuth
    let result = Command::new("claude")
        .args(["login"])
        .output()
        .map_err(|e| format!("Failed to run claude login: {}", e))?;

    if result.status.success() {
        // Check if credentials were created
        let connected = check_oauth().unwrap_or(false);
        let _ = app.emit("oauth-result", serde_json::json!({
            "success": connected,
            "error": if connected { "" } else { "Login completed but credentials not found" }
        }));

        if connected {
            let mut config = load_config();
            config.oauth_connected = true;
            let _ = save_config_to_disk(&config);
        }
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let _ = app.emit("oauth-result", serde_json::json!({
            "success": false,
            "error": format!("Login failed: {}", stderr.chars().take(200).collect::<String>())
        }));
    }

    Ok(())
}

#[tauri::command]
async fn start_server(app: AppHandle, state: tauri::State<'_, Mutex<ServerState>>) -> Result<(), String> {
    let config = load_config();

    // Emit step updates to frontend
    let emit = |step: &str, status: &str, msg: &str| {
        let _ = app.emit("server-status", serde_json::json!({
            "step": step,
            "status": status,
            "message": msg
        }));
    };

    // Step 1: Check prerequisites
    emit("check", "active", "");
    let has_node = Command::new("node").arg("--version").output().is_ok();
    let has_git = Command::new("git").arg("--version").output().is_ok();

    if !has_node {
        emit("check", "error", "Node.js is required. Install from nodejs.org");
        return Err("Node.js not found".into());
    }
    if !has_git {
        emit("check", "error", "Git is required. Install from git-scm.com");
        return Err("Git not found".into());
    }

    // Check/install pnpm
    let has_pnpm = Command::new("pnpm").arg("--version").output().is_ok();
    if !has_pnpm {
        let _ = Command::new("npm").args(["install", "-g", "pnpm"]).output();
    }
    emit("check", "done", "");

    let install_dir = PathBuf::from(&config.data_dir).join("askalf");

    // Step 2: Download/update
    if !install_dir.join("package.json").exists() {
        emit("download", "active", "");
        let _ = fs::create_dir_all(&config.data_dir);
        let result = Command::new("git")
            .args(["clone", "--depth", "1", "https://github.com/askalf/askalf.git"])
            .arg(&install_dir)
            .output()
            .map_err(|e| format!("Git clone failed: {}", e))?;

        if !result.status.success() {
            let err = String::from_utf8_lossy(&result.stderr);
            emit("download", "error", &err);
            return Err(format!("Clone failed: {}", err));
        }
        emit("download", "done", "");
    } else {
        emit("download", "active", "");
        let _ = Command::new("git")
            .args(["pull", "--ff-only"])
            .current_dir(&install_dir)
            .output();
        emit("download", "done", "");
    }

    // Step 3: Install dependencies
    if !config.installed {
        emit("install", "active", "");
        let result = Command::new("pnpm")
            .args(["install", "--frozen-lockfile"])
            .current_dir(&install_dir)
            .output()
            .or_else(|_| {
                Command::new("pnpm")
                    .args(["install"])
                    .current_dir(&install_dir)
                    .output()
            })
            .map_err(|e| format!("pnpm install failed: {}", e))?;

        if !result.status.success() {
            emit("install", "error", "Dependency install failed");
            return Err("pnpm install failed".into());
        }
        emit("install", "done", "");
    } else {
        emit("install", "done", "");
    }

    // Step 4: Build
    emit("build", "active", "");
    let build_steps = [
        "@askalf/core", "@askalf/database-adapter", "@askalf/redis-adapter",
        "@askalf/db", "@askalf/observability", "@askalf/email",
        "@askalf/database", "@askalf/auth", "@askalf/forge", "@askalf/standalone",
    ];
    for pkg in &build_steps {
        let _ = Command::new("pnpm")
            .args(["--filter", pkg, "build"])
            .current_dir(&install_dir)
            .output();
    }
    emit("build", "done", "");

    // Mark as installed for next time
    let mut updated_config = config.clone();
    updated_config.installed = true;
    let _ = save_config_to_disk(&updated_config);

    // Step 5: Start server
    emit("start", "active", "");

    // Generate .env if needed
    let env_path = PathBuf::from(&config.data_dir).join(".env");
    if !env_path.exists() {
        let env_content = format!(
            "ASKALF_MODE=standalone\nASKALF_DATA_DIR={}\nPORT={}\nANTHROPIC_API_KEY={}\nOPENAI_API_KEY={}\nADMIN_EMAIL=admin@localhost\nJWT_SECRET={}\nSESSION_SECRET={}\nFORGE_API_KEY=fk_{}\nCHANNEL_ENCRYPTION_KEY={}\nINTERNAL_API_SECRET={}\n",
            config.data_dir, config.port, config.anthropic_key, config.openai_key,
            hex::encode(&rand_bytes(32)), hex::encode(&rand_bytes(32)),
            hex::encode(&rand_bytes(24)), hex::encode(&rand_bytes(32)),
            hex::encode(&rand_bytes(32)),
        );
        let _ = fs::write(&env_path, &env_content);
    }

    // Parse .env for process environment
    let mut env_vars: Vec<(String, String)> = vec![
        ("ASKALF_MODE".into(), "standalone".into()),
        ("ASKALF_DATA_DIR".into(), config.data_dir.clone()),
        ("PORT".into(), config.port.to_string()),
        ("ANTHROPIC_API_KEY".into(), config.anthropic_key.clone()),
        ("NODE_ENV".into(), "production".into()),
    ];
    if !config.openai_key.is_empty() {
        env_vars.push(("OPENAI_API_KEY".into(), config.openai_key.clone()));
    }
    if let Ok(content) = fs::read_to_string(&env_path) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') { continue; }
            if let Some(eq) = line.find('=') {
                let key = line[..eq].to_string();
                let val = line[eq+1..].to_string();
                if !env_vars.iter().any(|(k, _)| k == &key) {
                    env_vars.push((key, val));
                }
            }
        }
    }

    let server_script = install_dir.join("apps").join("standalone").join("dist").join("index.js");
    let child = Command::new("node")
        .arg(&server_script)
        .current_dir(&install_dir)
        .envs(env_vars)
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    // Store the child process
    {
        let mut server = state.lock().unwrap();
        server.child = Some(child);
        server.running = true;
    }

    // Poll health endpoint
    let port = config.port;
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let url = format!("http://localhost:{}/health", port);
        for i in 0..60 {
            std::thread::sleep(Duration::from_millis(500));
            if let Ok(output) = Command::new("curl").args(["-s", "-o", "/dev/null", "-w", "%{http_code}", &url]).output() {
                let code = String::from_utf8_lossy(&output.stdout);
                if code.trim() == "200" {
                    let _ = app_clone.emit("server-status", serde_json::json!({
                        "step": "start",
                        "status": "ready",
                        "message": port.to_string()
                    }));
                    return;
                }
            }
            if i == 59 {
                let _ = app_clone.emit("server-status", serde_json::json!({
                    "step": "start",
                    "status": "error",
                    "message": "Server did not respond within 30 seconds"
                }));
            }
        }
    });

    emit("start", "done", "");
    Ok(())
}

#[tauri::command]
fn stop_server(state: tauri::State<'_, Mutex<ServerState>>) -> Result<(), String> {
    let mut server = state.lock().unwrap();
    if let Some(ref mut child) = server.child {
        let _ = child.kill();
        let _ = child.wait();
    }
    server.child = None;
    server.running = false;
    Ok(())
}

#[tauri::command]
fn open_dashboard() -> Result<(), String> {
    let config = load_config();
    let url = format!("http://localhost:{}", config.port);
    let _ = open::that(&url);
    Ok(())
}

fn rand_bytes(n: usize) -> Vec<u8> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
    let mut rng = seed;
    (0..n).map(|i| {
        rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407 + i as u64);
        (rng >> 32) as u8
    }).collect()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(ServerState { child: None, running: false }))
        .invoke_handler(tauri::generate_handler![
            get_config, save_config, start_server, stop_server, open_dashboard,
            check_oauth, start_oauth_login
        ])
        .setup(|app| {
            // System tray
            let quit = MenuItem::with_id(app, "quit", "Quit AskAlf", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("AskAlf")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            // Kill server before quitting
                            if let Some(state) = app.try_state::<Mutex<ServerState>>() {
                                let mut server = state.lock().unwrap();
                                if let Some(ref mut child) = server.child {
                                    let _ = child.kill();
                                }
                            }
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AskAlf Desktop");
}
