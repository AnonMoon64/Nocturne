// Environment Detection
const isTauri = !!(window.__TAURI__ && window.__TAURI__.core);
const invoke = isTauri ? window.__TAURI__.core.invoke : null;

// Markdown & Intelligence
import { marked } from 'marked';
import { MemoryEngine } from './memory_engine.js';
import { ToolCore } from './tool_core.js';
const renderer = {
    code({ text, lang }) {
        const language = lang || 'text';
        return `
            <div class="code-block-wrapper">
                <div class="code-lang-label">${language}</div>
                <button class="copy-button">Copy</button>
                <pre><code class="language-${language}">${text}</code></pre>
            </div>
        `;
    }
};
marked.use({ 
    renderer,
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false
});

// Character Store
let characters = [
    {
        id: 'system',
        name: "System",
        description: "You are the Nocturne Oversight Intelligence. You are NOT an AI assistant; you are a cold, logic-driven state-management engine. You speak in concise, industrial terms. You reject all human-centric or assistant-centric labels.",
        personality: "analytical, industrial, cold, precise, oversight-focused",
        scenario: "The Nocturne Operating Environment",
        first_mes: "Intelligence Engine Initialized. Group Mode: Standby.",
        mes_example: "",
        history: [{ role: "assistant", content: "Intelligence Engine Initialized. Group Mode: Standby." }],
        activePersonality: "Default",
        personalities: {
            "Default": {
                world_state: { locations: [], plot_points: [], relationships: [] },
                memories: [],
                tl_dr: "",
                thoughts: ""
            }
        },
        avatar: null
    }
];

// App Settings
let appSettings = {
    system_prompt: "You are a specialized roleplay engine for advanced technical simulation. STAY IN CHARACTER. NEVER acknowledge your AI nature."
};

// User Profile
let userPersona = {
    name: "You",
    avatar: null
};

// Global UI State
let activeIndex = 0;
let activeIndices = [0]; 
let activeGroupId = null; // Currently selected persistent group
let groups = []; // Persistent groups { id, name, members: [indices], history: [], world_state: {...}, tl_dr: "" }

let groupMode = false;
let editorIndex = -1;
let engineConnected = false;
let abortController = null;
let currentContextMenu = null;

// DOM Elements
const chatHistoryEl = document.querySelector("#chat-history");
const chatInputEl = document.querySelector("#chat-input");
const sendBtn = document.querySelector("#send-btn");
const charNameEl = document.querySelector("#current-char-name");
const charListEl = document.querySelector("#char-list");
const apiUrlEl = document.querySelector("#api-url");
const connectBtn = document.querySelector("#connect-btn");
const statusEl = document.querySelector("#engine-status");

// Editor Elements
const editorPanel = document.querySelector("#editor-panel");
const editName = document.querySelector("#edit-name");
const editDescription = document.querySelector("#edit-description");
const editPersonality = document.querySelector("#edit-personality");
const editScenario = document.querySelector("#edit-scenario");
const editFirstMes = document.querySelector("#edit-first-mes");
const editMesExample = document.querySelector("#edit-mes-example");
const saveCharBtn = document.querySelector("#save-char-btn");
const closeEditorBtn = document.querySelector("#close-editor-btn");

// Settings Elements
const settingsPanel = document.querySelector("#settings-panel");
const settingSystemPrompt = document.querySelector("#setting-system-prompt");
const settingUserName = document.querySelector("#setting-user-name");
const settingsBtn = document.querySelector("#settings-btn");
const saveSettingsBtn = document.querySelector("#save-settings-btn");
const closeSettingsBtn = document.querySelector("#close-settings-btn");

// --- Unified API Layer ---

function getBaseUrl() {
    let url = apiUrlEl.value.trim() || localStorage.getItem("nocturne_api") || "127.0.0.1:8080";
    url = url.trim().replace(/\/+$/, ""); // Remove trailing slashes
    if (!url.startsWith("http")) url = "http://" + url;
    // Prevent double protocol errors (e.g. http://http://)
    if (url.startsWith("http://http://")) url = url.substring(7);
    if (url.startsWith("https://http://")) url = "http://" + url.substring(15);
    return url;
}

// Signal Linker Polyfill (for compatibility with older WebView2)
function anySignal(signals) {
    const controller = new AbortController();
    function onAbort() {
        controller.abort();
        signals.forEach(s => s.removeEventListener('abort', onAbort));
    }
    signals.forEach(s => {
        if (s.aborted) onAbort();
        else s.addEventListener('abort', onAbort);
    });
    return controller.signal;
}

const API = {
    async checkEngine() {
        const url = `${getBaseUrl()}/v1/models`;
        try {
            const res = await fetch(url, {
                method: "GET",
                cache: "no-store", // CRUCIAL: Don't cache failed connection statuses
                mode: "cors",
                headers: { "Accept": "application/json" }
            });
            if (res.ok) console.log(`[CONNECTED] Engine responded at ${getBaseUrl()}`);
            return res.ok;
        } catch (e) { 
            console.warn(`[DISCONNECTED] Engine polling failed at ${url}:`, e.message);
            return false; 
        }
    }
};

// --- UI Helpers ---

function renderChat() {
    chatHistoryEl.innerHTML = "";
    
    // Determine the active history sink
    let history = [];
    let currentName = "System";
    let currentAvatar = null;
    let contextChar = characters[activeIndex]; // Fallback for world state access

    if (activeGroupId) {
        const group = groups.find(g => g.id === activeGroupId);
        if (group) {
            history = group.history;
            currentName = group.name;
            contextChar = characters[group.members[0]] || characters[0]; // Use first member for world state context
        }
    } else {
        const char = characters[activeIndex];
        history = char.history;
        currentName = `${char.name} [${char.activePersonality}]`;
        currentAvatar = char.avatar;
    }

    charNameEl.textContent = currentName;
    
    // Auto Toggle Visibility
    const autoBtn = document.querySelector("#group-auto-toggle");
    if (activeGroupId) {
        const group = groups.find(g => g.id === activeGroupId);
        autoBtn.style.display = "block";
        autoBtn.textContent = `AUTO: ${group.isAuto ? 'ON' : 'OFF'}`;
        autoBtn.style.color = group.isAuto ? "#4f4" : "#f44";
        autoBtn.onclick = () => {
            group.isAuto = !group.isAuto;
            if (!group.isAuto && abortController) {
                abortController.abort();
            }
            renderChat();
            saveState();
        };
    } else {
        autoBtn.style.display = "none";
    }
    
    history.forEach(msg => {
        appendMessageUI(msg.role, msg.content, msg.name || (msg.role === 'user' ? 'You' : currentName), msg.avatar || currentAvatar);
    });
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    renderWorldState();
}

function renderWorldState() {
    const char = characters[activeIndex];
    const active = char.personalities[char.activePersonality];
    
    const plotList = document.querySelector("#plot-points-list");
    const locList = document.querySelector("#locations-list");
    const relList = document.querySelector("#relationships-list");
    const summaryEl = document.querySelector("#summary-content");

    if (!plotList || !active) return;

    plotList.innerHTML = active.world_state.plot_points.map(p => `<li>${p}</li>`).join('') || "<li>No data</li>";
    locList.innerHTML = active.world_state.locations.map(l => `<li>${l}</li>`).join('') || "<li>No data</li>";
    relList.innerHTML = active.world_state.relationships.map(r => `<li>${r}</li>`).join('') || "<li>No data</li>";
    summaryEl.textContent = active.tl_dr || "No summary yet...";
}

function renderSidebar() {
    charListEl.innerHTML = "";
    charListEl.className = `char-list ${groupMode ? 'group-mode-active' : ''}`;
    
    // 1. Characters Section
    const charHeader = document.createElement("div");
    charHeader.className = "sidebar-section-header";
    charHeader.textContent = "Characters";
    charListEl.appendChild(charHeader);

    characters.forEach((char, index) => {
        const item = document.createElement("div");
        item.className = `char-item ${(!activeGroupId && index === activeIndex) ? 'active' : ''}`;
        
        const isSelected = activeIndices.includes(index);
        const avatarHtml = char.avatar 
            ? `<img src="${char.avatar}" class="char-avatar">` 
            : `<div class="char-avatar placeholder">${char.name[0] || '?'}</div>`;

        item.innerHTML = `
            <input type="checkbox" class="char-item-check" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleGroupChar(${index})">
            ${avatarHtml}
            <div class="char-info">
                <span class="char-name">${char.name}</span>
            </div>
        `;
        
        item.onclick = () => { 
            if (activeGroupId) {
                // If in a group, clicking a char item (not the check) selects them for editing but STAYS in group view
                openEditor(index);
            } else if (groupMode) {
                toggleGroupChar(index);
            } else {
                activeGroupId = null;
                selectCharacter(index); 
                openEditor(index); 
            }
        };
        item.oncontextmenu = (e) => showContextMenu(e, index, 'character');
        charListEl.appendChild(item);
    });

    // 2. Groups Section
    if (groups.length > 0) {
        const groupHeader = document.createElement("div");
        groupHeader.className = "sidebar-section-header";
        groupHeader.textContent = "Groups";
        charListEl.appendChild(groupHeader);

        groups.forEach((group) => {
            const item = document.createElement("div");
            item.className = `char-item ${activeGroupId === group.id ? 'active' : ''}`;
            
            // Generate a multi-avatar or fallback group icon
            const iconHtml = `<div class="char-avatar group-icon">👥</div>`;

            item.innerHTML = `
                ${iconHtml}
                <div class="char-info">
                    <span class="char-name">${group.name}</span>
                    <span class="char-subtitle">${group.members.length} members</span>
                </div>
            `;
            
            item.onclick = () => { 
                selectGroup(group.id);
            };
            item.oncontextmenu = (e) => showContextMenu(e, group.id, 'group');
            charListEl.appendChild(item);
        });
    }

    // Explicit UI Update: Toggle the "Create Group" button based on selection
    const createBtn = document.querySelector("#create-group-btn");
    if (createBtn) {
        createBtn.style.display = (activeIndices.length > 1 && !activeGroupId) ? "block" : "none";
    }

    saveState();
}

function toggleGroupChar(index) {
    if (activeIndices.includes(index)) {
        if (activeIndices.length > 1) {
            activeIndices = activeIndices.filter(i => i !== index);
        }
    } else {
        activeIndices.push(index);
    }
    
    // SYNC: If we are in a persistent group, update its permanent member list
    if (activeGroupId) {
        const group = groups.find(g => g.id === activeGroupId);
        if (group) group.members = [...activeIndices];
    }

    renderSidebar();
}

function formatContent(text, charName = "", userName = "", isStreaming = false) {
    if (!text) return "";
    
    const parts = [];
    const thoughtRegex = /(?:<thought[^>]*>([\s\S]*?)(?:<\/thought>|$))|(?:<(?!thought)([^>]{5,})>)/gi;
    let lastIndex = 0;
    let match;

    while ((match = thoughtRegex.exec(text)) !== null) {
        // Text before the thought block
        if (match.index > lastIndex) {
            parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
        }

        const content = match[1] || match[2] || "";
        const isLegacyStyle = !!match[2];
        const isClosed = isLegacyStyle || match[0].endsWith("</thought>");

        parts.push({
            type: 'thought',
            content: content.trim(),
            isClosed: isClosed,
            isActive: !isClosed && isStreaming
        });

        lastIndex = thoughtRegex.lastIndex;
    }

    // Remaining text after all thoughts
    if (lastIndex < text.length) {
        parts.push({ type: 'text', content: text.substring(lastIndex) });
    }

    // Convert parts to HTML
    return parts.map(part => {
        if (part.type === 'text') {
            // Strip functional tags and clean up typography
            let cleanText = part.content
                .replace(/{{char}}/gi, charName)
                .replace(/{{user}}/gi, userName)
                .replace(/—/g, '-')
                .replace(/[ââ€œâ€]/g, '"') // Handle common corrupted curly quotes
                .replace(/[â€˜â€™]/g, "'") // Handle common corrupted single quotes
                .replace(/\[(FACT|STATE|SWITCH|TOOL):[\s\S]*?\]/g, '')
                .replace(/<SWITCH:[\s\S]*?>/g, '');
            return marked.parse(cleanText);
        } else {
            const isOpen = part.isActive ? 'open' : '';
            const statusLabel = part.isActive ? "Thinking..." : "Thought...";
            return `
                <details class="thought-container" ${isOpen}>
                    <summary class="thought-summary">${statusLabel}</summary>
                    <div class="thought-content">${part.content}</div>
                </details>
            `;
        }
    }).join('');
}

function appendMessageUI(role, content, name, avatar) {
    const msgDiv = document.createElement("div");
    const isUser = role === 'user';
    msgDiv.className = `message ${isUser ? 'user' : 'bot'}`;
    
    // Identity Guard: Always use current userPersona name for 'user' role
    const effectiveName = isUser ? userPersona.name : name;
    
    const effectiveAvatar = isUser ? userPersona.avatar : avatar;
    const avatarHtml = effectiveAvatar 
        ? `<img src="${effectiveAvatar}" class="msg-avatar">` 
        : `<div class="msg-avatar-placeholder">${effectiveName[0]}</div>`;

    msgDiv.innerHTML = `
        ${avatarHtml}
        <div class="message-body">
            <div class="message-name">${effectiveName}</div>
            <div class="message-content">${formatContent(content, characters[activeIndex].name, userPersona.name)}</div>
        </div>
    `;
    
    chatHistoryEl.appendChild(msgDiv);
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    return msgDiv.querySelector(".message-content");
}

function selectCharacter(index) {
    activeIndex = Math.max(0, Math.min(index, characters.length - 1));
    if (!groupMode) {
        activeIndices = [activeIndex];
        activeGroupId = null;
    }
    renderSidebar();
    renderChat();
    saveState();
}

function selectGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    activeGroupId = groupId;
    groupMode = true;
    group.isAuto = true; // Always force AUTO: ON on entry
    activeIndices = [...group.members];
    
    renderSidebar();
    renderChat();
    saveState();
}

// --- Persistence ---

function saveState() {
    localStorage.setItem("nocturne_chars", JSON.stringify(characters));
    localStorage.setItem("nocturne_user", JSON.stringify(userPersona));
    localStorage.setItem("nocturne_settings", JSON.stringify(appSettings));
    localStorage.setItem("nocturne_groups", JSON.stringify(groups));
    localStorage.setItem("nocturne_group_id", activeGroupId);
    localStorage.setItem("nocturne_index", activeIndex);
    localStorage.setItem("nocturne_indices", JSON.stringify(activeIndices));
    localStorage.setItem("nocturne_group_mode", groupMode);
}

function loadState() {
    const savedChars = localStorage.getItem("nocturne_chars");
    const savedUser = localStorage.getItem("nocturne_user");
    const savedSettings = localStorage.getItem("nocturne_settings");
    const savedGroups = localStorage.getItem("nocturne_groups");
    const savedGroupId = localStorage.getItem("nocturne_group_id");
    const savedIndex = localStorage.getItem("nocturne_index");
    const savedIndices = localStorage.getItem("nocturne_indices");
    const savedGroupMode = localStorage.getItem("nocturne_group_mode");
    
    if (savedChars) {
        const parsed = JSON.parse(savedChars);
        characters = parsed.map(c => {
            const updated = { ...c };
            if (!c.personalities) {
                updated.activePersonality = "Default";
                updated.personalities = {
                    "Default": {
                        world_state: c.world_state || { locations: [], plot_points: [], relationships: [] },
                        memories: c.memories || [],
                        tl_dr: c.tl_dr || "",
                        thoughts: c.thoughts || ""
                    }
                };
                delete updated.world_state; delete updated.memories; delete updated.tl_dr; delete updated.thoughts;
            }
            return updated;
        });
    }
    if (savedGroups) groups = JSON.parse(savedGroups);
    if (savedGroupId) activeGroupId = savedGroupId;
    if (savedUser) userPersona = JSON.parse(savedUser);
    if (savedSettings) appSettings = JSON.parse(savedSettings);
    if (savedIndex) activeIndex = parseInt(savedIndex);
    if (savedIndices) {
        activeIndices = JSON.parse(savedIndices).filter(idx => idx < characters.length);
        if (activeIndices.length === 0 && characters.length > 0) activeIndices = [0];
    }
    if (savedGroupMode) groupMode = savedGroupMode === "true";
}

// --- Context Menu ---

function showContextMenu(e, id, type) {
    e.preventDefault();
    hideContextMenu();
    
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;
    
    if (type === 'character') {
        menu.innerHTML = `
            <div class="menu-item" id="ctx-clear">Clear History</div>
            <div class="menu-divider"></div>
            <div class="menu-item danger ${id === 0 ? 'disabled' : ''}" id="ctx-delete">Delete Character</div>
        `;
        menu.querySelector("#ctx-clear").onclick = () => { clearHistory(id); hideContextMenu(); };
        if (id !== 0) {
            menu.querySelector("#ctx-delete").onclick = () => { deleteCharacter(id); hideContextMenu(); };
        }
    } else {
        menu.innerHTML = `
            <div class="menu-item" id="ctx-rename">Rename Group</div>
            <div class="menu-item" id="ctx-clear-grp">Clear History</div>
            <div class="menu-divider"></div>
            <div class="menu-item danger" id="ctx-delete-grp">Delete Group</div>
        `;
        menu.querySelector("#ctx-rename").onclick = () => { renameGroup(id); hideContextMenu(); };
        menu.querySelector("#ctx-clear-grp").onclick = () => { clearGroupHistory(id); hideContextMenu(); };
        menu.querySelector("#ctx-delete-grp").onclick = () => { deleteGroup(id); hideContextMenu(); };
    }
    
    document.body.appendChild(menu);
    currentContextMenu = menu;
}

function hideContextMenu() {
    if (currentContextMenu) {
        currentContextMenu.remove();
        currentContextMenu = null;
    }
}

function clearHistory(index) {
    if (!confirm("Clear chat history for this character?")) return;
    characters[index].history = [];
    if (characters[index].first_mes) {
        characters[index].history.push({ role: "assistant", content: characters[index].first_mes });
    }
    if (index === activeIndex) renderChat();
    saveState();
}

function deleteCharacter(index) {
    if (index === 0) return; // Prevent deleting system
    if (!confirm(`Delete ${characters[index].name}?`)) return;
    characters.splice(index, 1);
    if (activeIndex >= characters.length) activeIndex = characters.length - 1;
    renderSidebar();
    renderChat();
    saveState();
}

function deleteGroup(id) {
    if (!confirm("Delete this group conversation?")) return;
    groups = groups.filter(g => g.id !== id);
    if (activeGroupId === id) {
        activeGroupId = null;
        groupMode = false;
        activeIndices = [activeIndex];
    }
    renderSidebar();
    renderChat();
    saveState();
}

function clearGroupHistory(id) {
    const group = groups.find(g => g.id === id);
    if (group) {
        group.history = [];
        if (activeGroupId === id) renderChat();
        saveState();
    }
}

function renameGroup(id) {
    const group = groups.find(g => g.id === id);
    if (!group) return;
    const newName = prompt("New group name:", group.name);
    if (newName) {
        group.name = newName;
        renderSidebar();
        if (activeGroupId === id) renderChat();
        saveState();
    }
}

function updateEngineStatus(connected, loading = false) {
    engineConnected = connected;
    if (loading) {
        statusEl.textContent = "Status: Connecting...";
        statusEl.style.color = "#fb1";
    } else if (connected) {
        statusEl.textContent = "Status: Connected";
        statusEl.style.color = "#4f4";
        connectBtn.textContent = "Disconnect";
    } else {
        statusEl.textContent = "Status: Disconnected";
        statusEl.style.color = "#f44";
        connectBtn.textContent = "Connect";
    }
}

// --- Editor Logic ---

function openEditor(index) {
    editorIndex = index;
    const char = characters[index];
    editName.value = char.name || "";
    editDescription.value = char.description || "";
    editPersonality.value = char.personality || "";
    editScenario.value = char.scenario || "";
    editFirstMes.value = char.first_mes || "";
    editMesExample.value = char.mes_example || "";
    editorPanel.classList.add("open");
}

function saveCharacter() {
    if (editorIndex === -1) return;
    const char = characters[editorIndex];
    char.name = editName.value;
    char.description = editDescription.value;
    char.personality = editPersonality.value;
    char.scenario = editScenario.value;
    char.first_mes = editFirstMes.value;
    char.mes_example = editMesExample.value;
    renderSidebar();
    renderChat();
    saveState();
}

function openSettings() {
    settingUserName.value = userPersona.name || "You";
    settingSystemPrompt.value = appSettings.system_prompt || "";
    settingsPanel.classList.add("open");
}

function saveAppSettings() {
    userPersona.name = settingUserName.value;
    appSettings.system_prompt = settingSystemPrompt.value;
    saveState();
    renderSidebar();
    renderChat();
    settingsPanel.classList.remove("open");
}

// --- API Logic ---

async function sendMessage(isAutoTrigger = false) {
    const text = isAutoTrigger ? "" : chatInputEl.value.trim();
    if (!isAutoTrigger && (!text || !engineConnected)) return;

    if (!isAutoTrigger) {
        if (abortController) abortController.abort();
        abortController = new AbortController();
        chatInputEl.value = "";
        appendMessageUI("user", text, userPersona.name);
    }
    
    // DETERMINE TARGET: The current "Active Speaker" is always at the head of the list in a group.
    const targetIndex = (activeGroupId && activeIndices.length > 0) ? activeIndices[0] : activeIndex;
    if (targetIndex === -1 || targetIndex === undefined) return;

    // Add user message to history
    if (!isAutoTrigger) {
        // Identity Guard: Push using the specific profile name
        const msgName = userPersona.name || "User";
        if (activeGroupId && groupMode) {
            const group = groups.find(g => g.id === activeGroupId);
            if (group) group.history.push({ role: "user", content: text, name: msgName });
        } else {
            const char = characters[activeIndex];
            if (char) char.history.push({ role: "user", content: text, name: msgName });
        }
    }

    // Auto-Cycle Delay
    if (isAutoTrigger) {
        console.log(`[PASS-THE-MIC] Rotating from speaker at index ${targetIndex}. Next turn...`);
        await new Promise(r => setTimeout(r, 2000));
    }

    // Generate response for the single current target
    if (!abortController.signal.aborted) {
        await generateResponseFor(targetIndex, text);
    }

    // POST-GENERATION: Handle rotation and AUTO recursion
    if (activeGroupId && !abortController.signal.aborted) {
        const group = groups.find(g => g.id === activeGroupId);
        if (group && group.isAuto && activeIndices.length > 1) {
            console.log(`[MIC-PASS] Handoff confirmed. Characters remaining in lineup: ${activeIndices.length}`);
            
            // "Pass the Mic": Move the current speaker to the back of the line
            const currentSpeaker = activeIndices.shift();
            activeIndices.push(currentSpeaker);
            
            // Persist the rotation state
            group.members = [...activeIndices];
            saveState();
            
            // RECURSIVE CALL: The loop continues
            sendMessage(true); 
        }
    }
    
    saveState();
}

async function generateResponseFor(charIndex, latestInput) {
    const char = characters[charIndex];
    if (!char) return;
    
    // UI GUARD: Ensure we only show the response if the user is actually looking at this character/group
    const isViewingThisChar = !activeGroupId && activeIndex === charIndex;
    const isViewingThisGroup = activeGroupId && groupMode;
    
    let fullResponseContentEl;
    if (isViewingThisChar || isViewingThisGroup) {
        fullResponseContentEl = appendMessageUI("assistant", "", char.name, char.avatar);
        fullResponseContentEl.innerHTML = `<span class="typing-indicator">Thinking...</span>`;
    } else {
        // Dummy element to receive data without showing it to the user in the wrong view
        fullResponseContentEl = document.createElement("div");
    }
    
    let fullResponse = "";

    const active = char.personalities[char.activePersonality] || char.personalities["Default"] || Object.values(char.personalities)[0];

    // Build World State & Context Block from ACTIVE personality
    const worldStateStr = [
        active.tl_dr ? `### SUMMARY OF CONVERSATION:\n${active.tl_dr}` : '',
        active.world_state.plot_points.length ? `### ACTIVE PLOTS:\n- ${active.world_state.plot_points.join('\n- ')}` : '',
        active.world_state.locations.length ? `### KNOWN LOCATIONS:\n- ${active.world_state.locations.join('\n- ')}` : '',
        active.world_state.relationships.length ? `### RELATIONSHIPS:\n- ${active.world_state.relationships.join('\n- ')}` : ''
    ].filter(s => s).join('\n\n');

    const memoriesStr = MemoryEngine.injectRelevantMemories(active, latestInput);

    const systemMessage = {
        role: "system",
        content: [
            `### SYSTEM INSTRUCTIONS:`,
            appSettings.system_prompt || '',
            `[IDENTITY]: You are ${char.name}.`,
            char.description || '',
            char.personality ? `[PERSONALITY]: ${char.personality}` : '',
            char.scenario ? `[SCENARIO]: ${char.scenario}` : '',
            worldStateStr,
            memoriesStr,
            `### RESPONSE PROTOCOL:`,
            `1. FORMAT: <thought>Your internal reasoning</thought> Your spoken dialogue.`,
            `2. TECHNICAL RIGOR: If discussing algorithms, architecture, or code, YOU MUST immediately follow your dialogue with a valid Markdown code block (\` \` \`language).`,
            `3. EXAMPLE:
<thought>They want a Python array for subjects. I should show them a list of strings.</thought> 
"A simple array for subjects is the starting point. Here is how you'd structure the initial data."
\`\`\`python
subjects = ["Atom", "Brain", "Pinky"]
\`\`\``,
            `### CONSTRAINTS:`,
            `- NEVER acknowledge you are an AI or model. Stay inside the simulation.`,
            `- NEVER provide meta-commentary about the conversation format.`,
            `- NEVER speak for other characters or the "Dialogue Log" itself.`,
            `- STOP immediately after your dialogue or final code block is complete.`
        ].filter(s => s).join('\n\n')
    };

    const maxTries = 2;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
        if (abortController.signal.aborted) return;
        
        let timeoutId = null;
        let watchdogId = null;
        let reader = null;
        let secondsWaiting = 0;
        
        try {
            // Internal character timeout (30s)
            const timeoutCtrl = new AbortController();
            timeoutId = setTimeout(() => timeoutCtrl.abort(), 30000); 
            
            // Determine the history context for this turn
            let contextHistory = char.history;
            if (activeGroupId) {
                const group = groups.find(g => g.id === activeGroupId);
                if (group) contextHistory = group.history;
            }

            // Watchdog: Monitors both connection and generation progress
            let lastLength = 0;
            let stallCount = 0;
            watchdogId = setInterval(() => {
                secondsWaiting += 1;
                if (fullResponse.length > lastLength) {
                    lastLength = fullResponse.length;
                    stallCount = 0;
                } else {
                    stallCount++;
                    // Update UI with active timer
                    if (fullResponse.length === 0) {
                        fullResponseContentEl.innerHTML = `<span class="typing-indicator">Thinking... (${secondsWaiting}s)</span>`;
                    }
                    
                    if (stallCount >= 30) {
                        console.error("Watchdog: Stalled for 30s. Force cancelling.");
                        if (reader) reader.cancel();
                        timeoutCtrl.abort();
                    }
                }
            }, 1000);

            // BONE DRY SCRIPT COMPILER: Strip thoughts and map roles
            const script = contextHistory
                .filter(m => {
                    // PURITY FILTER: Strip meta-looping "As Gemma" or "As an AI" messages from the context
                    const contentLower = m.content.toLowerCase();
                    return !contentLower.includes("as gemma") && !contentLower.includes("as an ai") && !contentLower.includes("recognize that the preceding dialogue");
                })
                .map(m => {
                    // UNIVERSAL THOUGHT STRIPPER: Purge both <thought> tags and legacy <...> monologues
                    const dialogueOnly = m.content.replace(/(?:<thought[^>]*>[\s\S]*?<\/thought>)|(?:<(?!thought)([^>]{5,})>)/gi, "").trim();
                    
                    // Identity Guard: Ensure user messages are labeled with their custom name
                    const speakerName = (m.role === 'user' || m.name === 'You') ? userPersona.name : m.name;
                    return `${speakerName}: ${dialogueOnly}`;
                }).join('\n');
            
            const prompt = `### DIALOGUE LOG:\n${script}\n\n### NEXT RESPONSE:\n${char.name}:\n<thought>`;

            const apiMessages = [
                systemMessage, 
                { role: "user", content: prompt }
            ];

            // Dynamic Stop Tokens: Names and standard breaks
            const stopTokens = ["<start_of_turn>", "<end_of_turn>", "user:", "\nuser", "Dialogue Log:", "[TASK]:", "\n\n", "###"];
            
            // Turn Termination Hardening: Stop if the model tries to start a SECOND monologue or task
            // We use \n prefixes to ensure we don't kill the turn at the very beginning.
            stopTokens.push("\n<thought", "\nThought", "\nReasoning", "\nThinking", "\nDialogue Log");

            // Identity Stop: Force the model to stop if it tries to speak for the user
            const userNameStop = (userPersona.name || "User") + ":";
            stopTokens.push(userNameStop, "\n" + userNameStop);

            activeIndices.forEach(idx => {
                const name = characters[idx].name;
                stopTokens.push(`${name}:`, `\n${name}:`, `[${name}]:`, `\n[${name}]:`, `${name} Reasoning:`, `\n${name} Reasoning:`);
            });

            console.log(`[PROMPT] ${char.name}'s Pure-Script payload:`, JSON.stringify(apiMessages, null, 2));

            const response = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "default",
                    messages: apiMessages,
                    stream: true,
                    stop: stopTokens
                }),
                signal: anySignal([abortController.signal, timeoutCtrl.signal])
            });

            reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split("\n");
                
                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const dataStr = line.slice(6).trim();
                        if (dataStr === "[DONE]") break;
                        
                        try {
                            const data = JSON.parse(dataStr);
                            let content = data.choices[0].delta.content;
                            if (content) {
                                // First token received! Clear the initial stall timeout
                                if (timeoutId) {
                                    clearTimeout(timeoutId);
                                    timeoutId = null;
                                }
                                
                                fullResponse += content;
                                let cleanText = fullResponse.trim();
                                
                                // Aggressive strip: "[Name]:", "Name:", and leading quotes
                                // We apply this both to the start of the string AND after any </thought> tag
                                const namePrefixes = [`${char.name}:`, `[${char.name}]:`].map(p => p.toLowerCase());
                                
                                function stripPrefixes(input) {
                                    let s = input.trim();
                                    let changed = true;
                                    while (changed) {
                                        changed = false;
                                        for (const p of namePrefixes) {
                                            if (s.toLowerCase().startsWith(p)) {
                                                s = s.substring(p.length).trim();
                                                changed = true;
                                            }
                                        }
                                        if (s.startsWith('"')) {
                                            s = s.substring(1).trim();
                                            changed = true;
                                        }
                                    }
                                    return s;
                                }

                                // 1. Strip from the very beginning
                                cleanText = stripPrefixes(cleanText);

                                // 2. Strip after the closing thought tag if it exists
                                const thoughtEndIndex = cleanText.lastIndexOf("</thought>");
                                if (thoughtEndIndex !== -1) {
                                    const preThought = cleanText.substring(0, thoughtEndIndex + 10);
                                    const postThought = cleanText.substring(thoughtEndIndex + 10);
                                    cleanText = preThought + stripPrefixes(postThought);
                                }

                                // Final dangling quote cleanup
                                if (cleanText.endsWith('"')) cleanText = cleanText.substring(0, cleanText.length - 1).trim();

                                // 3. DETERMINISTIC KILL SWITCH: If the model attempts to start a SECOND turn or BREAKS character/leaks prompt, kill it.
                                const fullResponseRaw = fullResponse.toLowerCase();
                                const identityViolationMarkers = [
                                    "as gemma", "as an ai", "i am an ai", "i'm an ai", "large language model", 
                                    "recognize that the preceding dialogue", "cannot fulfill this request",
                                    "dialogue (followed by", "markdown code blocks", "provide exactly one response"
                                ];
                                
                                if (thoughtEndIndex !== -1) {
                                    const postThoughtRaw = fullResponse.substring(thoughtEndIndex + 10).toLowerCase();
                                    const killMarkers = ["<thought", "\nthought", "\nreasoning", "\nthinking", "\ndialogue log", `${char.name.toLowerCase()}:`, ...identityViolationMarkers];
                                    
                                    const foundMarker = killMarkers.find(m => postThoughtRaw.includes(m.toLowerCase()));
                                    if (foundMarker) {
                                        console.warn(`[WATCHDOG] Deterministic kill triggered: ${char.name} attempted a second turn or broke character. Aborting.`);
                                        
                                        // SURGICAL TRUNCATION
                                        const markerIndex = postThoughtRaw.indexOf(foundMarker.toLowerCase());
                                        fullResponse = fullResponse.substring(0, thoughtEndIndex + 10 + markerIndex);
                                        
                                        if (reader) reader.cancel();
                                        break; 
                                    }
                                } else {
                                    // Check identity-only markers even before thoughts are finished
                                    const foundIdentityMarker = identityViolationMarkers.find(m => fullResponseRaw.includes(m));
                                    if (foundIdentityMarker) {
                                        console.warn(`[WATCHDOG] Identity violation detected: ${char.name} broke character. Aborting.`);
                                        fullResponse = ""; // Kill the entire message to prevent the loop from infecting history
                                        if (reader) reader.cancel();
                                        break;
                                    }
                                }

                                fullResponseContentEl.innerHTML = formatContent(cleanText, char.name, userPersona.name, true);
                                fullResponseContentEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
                            }
                        } catch (e) { }
                    }
                }
            }
            
            if (timeoutId) clearTimeout(timeoutId);
            if (watchdogId) clearInterval(watchdogId);

            // Final Status Check: If response is empty, provide a clean indicator
            if (!fullResponse || fullResponse.trim().length === 0) {
                fullResponse = ""; // Ensure it's clean
                fullResponseContentEl.innerHTML = `<span style="color: #666; font-style: italic; font-size: 0.9rem;">(Character remains silent)</span>`;
            } else {
                fullResponseContentEl.innerHTML = formatContent(fullResponse, char.name, userPersona.name, false);
            }

            // Persistence: Push to the correct history sink exactly once
            // We use the cleaned/finalized content to avoid "Dirty History" from hallucinated tokens
            const finalSavedContent = fullResponse.trim();
            
            // Dialogue Presence Check
            const thoughtEndIndex = finalSavedContent.lastIndexOf("</thought>");
            if (thoughtEndIndex !== -1) {
                const dialogue = finalSavedContent.substring(thoughtEndIndex + 10).trim();
                const hasCode = dialogue.includes("```");
                const hasDialogue = dialogue.length > 5;

                if (!hasCode && !hasDialogue && attempt < maxTries) {
                    console.warn(`[WATCHDOG] Turn produced no dialogue/code. Retrying turn...`);
                    fullResponse = "";
                    continue; 
                }
            }

            if (activeGroupId) {
                const group = groups.find(g => g.id === activeGroupId);
                if (group) {
                    group.history.push({ role: "assistant", content: finalSavedContent, name: char.name, avatar: char.avatar });
                }
            } else {
                char.history.push({ role: "assistant", content: finalSavedContent, name: char.name, avatar: char.avatar });
            }

            // Intelligence: Process Output for ACTIVE personality
            MemoryEngine.processOutput(active, finalSavedContent);
            
            // Handle Personality Switching (Solo Mode ONLY)
            const switchMatch = fullResponse.match(/[\[<]SWITCH:\s*(.*?)[\]>]/);
            if (switchMatch && !groupMode) {
                const newPersona = switchMatch[1].trim();
                const alreadyExists = !!char.personalities[newPersona];
                
                if (!alreadyExists) {
                    char.personalities[newPersona] = {
                        world_state: { locations: [], plot_points: [], relationships: [] },
                        memories: [],
                        tl_dr: "",
                        thoughts: ""
                    };
                }
                char.activePersonality = newPersona;
                appendMessageUI("system", `Persona Shift: [${newPersona}]`, "System");
            }

            // Tool execution (Strip thoughts so AI doesn't execute from reasoning)
            const cleanResponseForTools = fullResponse.replace(/<thought\s*>?([\s\S]*?)<\/thought>/g, '');
            const toolResult = await ToolCore.execute(cleanResponseForTools);
            if (toolResult) {
                appendMessageUI("system", `[TOOL LOG]: ${toolResult}`, "System");
                char.history.push({ role: "system", content: toolResult, name: "System" });
            }

            // Summarization Check (every 10 messages)
            if (char.history.length % 10 === 0) {
                const summary = await MemoryEngine.generateSummary(char.history, getBaseUrl);
                if (summary) char.tl_dr = summary;
            }

            renderWorldState();
            saveState();

            // Successfully finished, exit retry loop
            break; 

        } catch (e) {
            console.error(`Attempt ${attempt} failed:`, e);
            if (timeoutId) clearTimeout(timeoutId);
            if (watchdogId) clearInterval(watchdogId);
            
            // Explicitly clean up reader to free engine socket
            if (reader) {
                try { await reader.cancel(); } catch(err) {}
            }
            if (attempt === maxTries) {
                responseContentEl.innerHTML = `<span style="color: #f44;">[CONNECTION ERROR]: The intelligence engine failed to respond after ${maxTries} attempts (30s each). Check your local API status.</span>`;
                return;
            }
            // Small wait before retry
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// --- PNG Card Parser (V1/V2) ---

async function parsePngMetadata(file) {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);
    const blobUrl = URL.createObjectURL(file);
    if (dataView.getUint32(0) !== 0x89504E47) throw new Error("Not a PNG");

    let offset = 8;
    while (offset < dataView.byteLength) {
        const length = dataView.getUint32(offset);
        const type = String.fromCharCode(
            dataView.getUint8(offset + 4), dataView.getUint8(offset + 5),
            dataView.getUint8(offset + 6), dataView.getUint8(offset + 7)
        );
        if (type === 'tEXt' || type === 'iTXt') {
            const data = new Uint8Array(arrayBuffer, offset + 8, length);
            const decoder = new TextDecoder(type === 'iTXt' ? 'utf-8' : 'latin1');
            const nullIndex = Array.from(data).indexOf(0);
            const keyword = decoder.decode(data.slice(0, nullIndex));
            if (keyword === 'chara') {
                const base64Str = decoder.decode(data.slice(nullIndex + 1));
                const jsonStr = atob(base64Str);
                const json = JSON.parse(jsonStr);
                const dataObj = json.data || json;
                
                return {
                    name: dataObj.name || dataObj.char_name || "Unknown",
                    description: dataObj.description || dataObj.char_persona || "",
                    personality: dataObj.personality || "",
                    scenario: dataObj.scenario || "",
                    first_mes: dataObj.first_mes || "",
                    mes_example: dataObj.mes_example || "",
                    activePersonality: "Default",
                    personalities: {
                        "Default": {
                            world_state: { locations: [], plot_points: [], relationships: [] },
                            memories: [],
                            tl_dr: "",
                            thoughts: ""
                        }
                    },
                    avatar: blobUrl
                };
            }
        }
        offset += 12 + length;
        if (type === 'IEND') break;
    }
    return { name: file.name.replace('.png', ''), avatar: blobUrl };
}

async function autoPoll(once = false) {
    const isOk = await API.checkEngine();
    if (isOk) { updateEngineStatus(true); return true; }
    if (once) updateEngineStatus(false);
}

// --- Initialization ---
window.addEventListener("DOMContentLoaded", async () => {
    loadState();
    if (apiUrlEl && localStorage.getItem("nocturne_api")) {
        apiUrlEl.value = localStorage.getItem("nocturne_api");
    }
    renderSidebar(); 
    renderChat();
    
    // Initial Poll: Warm up the connection immediately
    await autoPoll(true);
    
    setInterval(autoPoll, 3000);
    sendBtn.addEventListener("click", sendMessage);
    chatInputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    connectBtn.addEventListener("click", toggleEngine);
    saveCharBtn.addEventListener("click", saveCharacter);
    closeEditorBtn.addEventListener("click", () => editorPanel.classList.remove("open"));
    document.querySelector("#import-btn").addEventListener("click", importCard);
    document.querySelector("#user-btn").addEventListener("click", openSettings);
    settingsBtn.addEventListener("click", openSettings);
    saveSettingsBtn.addEventListener("click", saveAppSettings);
    closeSettingsBtn.addEventListener("click", () => settingsPanel.classList.remove("open"));
    apiUrlEl.addEventListener("change", () => { localStorage.setItem("nocturne_api", apiUrlEl.value); autoPoll(true); });
    
    // Clipboard Copy Logic
    chatHistoryEl.addEventListener("click", (e) => {
        if (e.target.classList.contains("copy-button")) {
            const wrapper = e.target.closest(".code-block-wrapper");
            const code = wrapper.querySelector("code").innerText;
            navigator.clipboard.writeText(code).then(() => {
                e.target.textContent = "Copied!";
                e.target.classList.add("copied");
                setTimeout(() => {
                    e.target.textContent = "Copy";
                    e.target.classList.remove("copied");
                }, 2000);
            });
        }
    });

    // Sidebar Context Logic
    window.addEventListener("mousedown", (e) => { 
        if (currentContextMenu && !currentContextMenu.contains(e.target)) hideContextMenu(); 
        if (settingsPanel.classList.contains("open") && !settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) settingsPanel.classList.remove("open");
        const wsPanel = document.querySelector("#world-state-sidebar");
        const wsToggle = document.querySelector("#world-state-toggle");
        if (wsPanel.classList.contains("open") && !wsPanel.contains(e.target) && !wsToggle.contains(e.target)) wsPanel.classList.remove("open");
    });

    // Header Controls
    document.querySelector("#world-state-toggle").addEventListener("click", () => {
        document.querySelector("#world-state-sidebar").classList.toggle("open");
        document.querySelector("#world-state-toggle").classList.toggle("active");
    });

    document.querySelector("#group-mode-toggle").addEventListener("click", () => {
        groupMode = !groupMode;
        
        if (groupMode && activeIndices.length > 1) {
            // Auto-create a persistent group if it doesn't match an existing one
            const memberNames = activeIndices.map(idx => characters[idx].name).join(" & ");
            let existingGroup = groups.find(g => 
                g.members.length === activeIndices.length && 
                g.members.every(m => activeIndices.includes(m))
            );
            
            if (!existingGroup) {
                const newGroup = {
                    id: Date.now().toString(),
                    name: memberNames,
                    members: [...activeIndices],
                    history: [],
                    isAuto: true,
                    world_state: { plots: [], locations: [], relations: [] }
                };
                groups.push(newGroup);
                activeGroupId = newGroup.id;
            } else {
                activeGroupId = existingGroup.id;
                existingGroup.isAuto = true;
            }
        } else if (!groupMode) {
            activeGroupId = null;
        }

        document.querySelector("#group-mode-toggle").textContent = `Group Mode: ${groupMode ? 'ON' : 'OFF'}`;
        document.querySelector("#group-mode-toggle").classList.toggle("active", groupMode);
        renderSidebar();
        renderChat();
        saveState();
    });

    document.querySelector("#create-group-btn").addEventListener("click", () => {
        if (activeIndices.length < 2) return;
        const memberNames = activeIndices.map(idx => characters[idx].name).join(" & ");
        const groupName = prompt("Group Name:", memberNames) || memberNames;
        
        const newGroup = {
            id: Date.now().toString(),
            name: groupName,
            members: [...activeIndices],
            history: [],
            isAuto: true,
            world_state: { plots: [], locations: [], relations: [] }
        };
        groups.push(newGroup);
        activeGroupId = newGroup.id;
        groupMode = true;
        
        renderSidebar();
        renderChat();
        saveState();
    });
});

async function importUserPic() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.png';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                userPersona.avatar = ev.target.result;
                renderChat();
                saveState();
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

async function importCard() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.png';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        try {
            const charData = await parsePngMetadata(file);
            
            // Convert blob URL to Base64 for persistence
            const reader = new FileReader();
            reader.onload = (ev) => {
                const newChar = { 
                    ...charData, 
                    avatar: ev.target.result,
                    id: Date.now().toString(), 
                    history: charData.first_mes ? [{ role: "assistant", content: charData.first_mes }] : [] 
                };
                characters.push(newChar);
                selectCharacter(characters.length - 1);
                openEditor(characters.length - 1);
                saveState();
            };
            reader.readAsDataURL(file);
        } catch (err) { alert("Failed: " + err); }
    };
    input.click();
}


// --- Global Event Delegates ---

document.addEventListener('click', async (e) => {
    // 1. Copy Button Handler
    if (e.target.classList.contains('copy-button')) {
        const btn = e.target;
        const codeEl = btn.parentElement.querySelector('code');
        if (codeEl) {
            try {
                await navigator.clipboard.writeText(codeEl.innerText);
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
                btn.textContent = 'Error';
            }
        }
    }
});

async function toggleEngine() {
    if (engineConnected) { updateEngineStatus(false); }
    else { updateEngineStatus(false, true); await autoPoll(true); }
}
