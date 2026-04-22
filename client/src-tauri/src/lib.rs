use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use tauri::{State, Manager};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CharacterData {
    pub name: String,
    pub description: Option<String>,
    pub personality: Option<String>,
    pub scenario: Option<String>,
    pub first_mes: Option<String>,
    pub mes_example: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CharacterCardV2 {
    pub spec: String,
    pub spec_version: String,
    pub data: CharacterData,
}

pub struct EngineState(Mutex<Option<Child>>);

#[tauri::command]
async fn list_models() -> Result<Vec<String>, String> {
    let mut models = Vec::new();
    // Path relative to execution dir or absolute
    let models_dir = Path::new("../SparkLLM/models");
    if !models_dir.exists() {
        return Err("Models directory not found".to_string());
    }

    for entry in fs::read_dir(models_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("gguf") {
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                models.push(name.to_string());
            }
        }
    }
    Ok(models)
}

#[tauri::command]
async fn start_engine(state: State<'_, EngineState>, model_name: String) -> Result<String, String> {
    let mut lock = state.0.lock().unwrap();
    if lock.is_some() {
        return Err("Engine is already running".to_string());
    }

    let exe_path = Path::new("../SparkLLM/build/Release/SparkLLM.exe");
    let model_path = Path::new("../SparkLLM/models").join(model_name);

    if !exe_path.exists() {
        return Err(format!("Engine executable not found at {:?}", exe_path));
    }

    let child = Command::new(exe_path)
        .arg("-m")
        .arg(model_path)
        .arg("--port")
        .arg("8080")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start engine: {}", e))?;

    *lock = Some(child);
    Ok("Engine started".to_string())
}

#[tauri::command]
async fn stop_engine(state: State<'_, EngineState>) -> Result<String, String> {
    let mut lock = state.0.lock().unwrap();
    if let Some(mut child) = lock.take() {
        child.kill().map_err(|e| format!("Failed to kill engine: {}", e))?;
        Ok("Engine stopped".to_string())
    } else {
        Err("Engine is not running".to_string())
    }
}

#[tauri::command]
async fn load_character_card(path: String) -> Result<CharacterData, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("File not found".to_string());
    }

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut decoder = png::Decoder::new(file);
    let reader = decoder.read_info().map_err(|e| e.to_string())?;
    let info = reader.info();

    for chunk in &info.uncompressed_latin1_text {
        if chunk.keyword == "chara" {
            let decoded = general_purpose::STANDARD
                .decode(&chunk.text)
                .map_err(|e| format!("Base64 decode error: {}", e))?;
            
            let json_str = String::from_utf8(decoded)
                .map_err(|e| format!("UTF8 error: {}", e))?;

            if let Ok(v2) = serde_json::from_str::<CharacterCardV2>(&json_str) {
                return Ok(v2.data);
            }
            
            if let Ok(v1) = serde_json::from_str::<CharacterData>(&json_str) {
                return Ok(v1);
            }

            return Err("Invalid character card format".to_string());
        }
    }

    Err("No 'chara' chunk found in PNG".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_character_card, 
            list_models, 
            start_engine, 
            stop_engine
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: State<EngineState> = window.state();
                let mut lock = state.0.lock().unwrap();
                if let Some(mut child) = lock.take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
