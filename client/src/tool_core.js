/**
 * Nocturne Tool Core
 * Provides capability for the AI to interact with the file system.
 */

const isTauri = !!(
    (window.__TAURI__ && window.__TAURI__.core) || 
    (window.__TAURI_ANTIGRAVITY__) || 
    (window.__TAURI__)
);
const invoke = isTauri ? (window.__TAURI__.core?.invoke || window.__TAURI__.invoke) : null;

export const ToolCore = {
    definitions: [
        {
            name: "create_file",
            description: "Creates a new file or overwrites an existing one in the project workspace.",
            parameters: {
                path: "string (e.g., 'src/new_component.js')",
                content: "string (The full content of the file)"
            }
        },
        {
            name: "read_file",
            description: "Reads the content of a file from the project workspace.",
            parameters: {
                path: "string (e.g., 'src/main.js')"
            }
        }
    ],

    getSystemInstruction() {
        return `
### TOOL CAPABILITIES:
You have access to a project workspace. You can create and read files using the following JSON command format in your response:
[TOOL: name {"param": "value"}]

Example:
[TOOL: create_file {"path": "hello.txt", "content": "Hello World"}]

When you use a tool, it will be executed immediately. You can then use the content to reason about the project.
        `;
    },

    async execute(toolCall) {
        if (!toolCall || !toolCall.includes("[TOOL:")) return null;

        const match = toolCall.match(/\[TOOL:\s*(\w+)\s*(.*?)\]/);
        if (!match) return null;

        const name = match[1];
        const argsStr = match[2].trim();
        
        let args = {};
        if (argsStr) {
            try {
                // Handle cases where the model might omit braces or use single quotes
                let sanitizedArgs = argsStr;
                if (!sanitizedArgs.startsWith("{")) sanitizedArgs = "{" + sanitizedArgs + "}";
                args = JSON.parse(sanitizedArgs);
            } catch (e) { 
                return `Error parsing tool arguments for ${name}: ${e.message}. (Expected JSON, got: ${argsStr})`; 
            }
        }

        if (!isTauri) return "Tool execution is only available in the Tauri desktop environment.";

        try {
            if (name === "create_file") {
                // Use Tauri FS (assuming the plugin is enabled)
                const { writeFile, BaseDirectory } = window.__TAURI__.fs;
                await writeFile(args.path, args.content, { baseDir: BaseDirectory.AppConfig }); 
                return `File created successfully: ${args.path}`;
            }

            if (name === "read_file") {
                const { readTextFile, BaseDirectory } = window.__TAURI__.fs;
                const content = await readTextFile(args.path, { baseDir: BaseDirectory.AppConfig });
                return `Content of ${args.path}:\n${content}`;
            }
        } catch (e) {
            return `Error executing tool ${name}: ${e.message}`;
        }

        return `Unknown tool: ${name}`;
    }
};
