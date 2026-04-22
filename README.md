# Nocturne UI Engine

A lightweight, high-performance, and industrial-styled UI for the **SparkLLM** inference engine. Designed for advanced character interaction with a minimalist, sharp, and dark aesthetic.

## Features
- **Engine Management**: Automatically launch and manage your `SparkLLM.exe` process directly from the UI.
- **"Bone Dry" Stream Filtering**: Engine-level logic that surgically hides `<start_of_turn>` and `<end_of_turn>` tags, ensuring a perfectly clean dialogue stream with zero tag flickering.
- **Universal Stop Logic**: Prevents AI hallucination loops by detecting *any* turn markers at the engine level and aborting generation instantly.
- **Hardened Persona Protocol**:
    - **Roleplay Protocol**: Injects character instructions directly into the dialogue history to maximize persona adherence on instruction-tuned models like Gemma 2.
    - **Typography Filter**: Native em-dash (`—`) filtering to ensure consistent character dialogue style.
- **Advanced Character System**:
    - **PNG Import**: Supports SillyTavern V1/V2 character cards with metadata parsing.
    - **User Profile**: Custom user persona support with PNG avatar uploads.
    - **Live Editor**: Integrated side-panel for real-time editing of character personalities, scenarios, and greetings.
    - **Isolated History**: Each character maintains a clean, private history record, decoupling solo interactions from group chats.
- **Group Intelligence Prototype**:
    - **Persistent Grouping**: Create and name multi-character groups that live permanently in your sidebar.
    - **Auto-Generation Cycle**: Integrated "AUTO" mode that allows characters to converse indefinitely in a self-sustaining loop.
    - **Data-Driven Context**: Groups use a high-stability injection protocol that prevents "prefix nesting" and ensures the AI maintains perfect group coordination.
    - **Honest Silence Feedback**: If the AI returns zero tokens, the UI provides a subtle italicized indicator rather than masking the failure.
- **Reliability & Watchdog**:
    - **Internal Thought Visualization**: Real-time rendering of character `<thought>` tags as interactive "Thinking..." status bubbles.
    - **Thought Privacy**: Character reasoning is surgically isolated; the engine prevents characters from "seeing" or being confused by each other's internal monologues.
    - **Live Connection Feedback**: Visual timers that show how many seconds the engine has been connected.
    - **Forceful Reader Watchdog**: Monitors network throughput and automatically cancels/retries stalled connections if no progress is made within 30 seconds.
- **Rich Interaction**:
    - **Markdown UI**: Full Markdown support for roleplay with specialized italicized action styling.
    - **Functional Code Support**: Automatic labeling of code languages and integrated "Copy" buttons for high-speed data transfer.
    - **Modern Industrial Design**: Sharp edges, monochrome palette, and a high-readability vertical document layout.

## Getting Started

### Prerequisites
- **Node.js** (for the UI server)
- **SparkLLM.exe** (place in `SparkLLM/build/Release/`)
- **GGUF Models** (place in `SparkLLM/models/`)

### Launching the App
Simply run the launcher in the root directory:
```bash
Launch_Nocturne.bat
```
The launcher will automatically check your environment. If Rust is missing, it will start **Browser Mode** utilizing a high-performance Vite proxy to manage your engine.

## Controls
- **Sidebar**: Manage and switch between characters.
- **Connect**: Toggle the SparkLLM engine on/off.
- **Chat**: Vertical stacked messages with full-width bubbles.
- **Editor**: Click a character to open its data fields on the right.

## Technical Stack
- **Backend**: Tauri 2.0 (Rust) / Vite Middleware (Node.js)
- **Frontend**: Vanilla JS / CSS / HTML5 / Marked (MD Engine)
- **Inference**: SparkLLM API or KoboldCpp (OpenAI Compatible)
