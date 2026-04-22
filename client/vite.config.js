import { defineConfig } from 'vite'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

let sparkProcess = null;

const sparkPlugin = () => ({
  name: 'spark-launcher-proxy',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/api/list-models') {
        const modelsDir = path.resolve(__dirname, '../SparkLLM/models');
        if (!fs.existsSync(modelsDir)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Models dir not found' }));
          return;
        }
        const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.gguf'));
        res.end(JSON.stringify(files));
      } 
      else if (req.url === '/api/start-engine' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const { modelName } = JSON.parse(body);
          if (sparkProcess) {
             res.statusCode = 400;
             res.end(JSON.stringify({ error: 'Engine already running' }));
             return;
          }
          const exePath = path.resolve(__dirname, '../SparkLLM/build/Release/SparkLLM.exe');
          const modelPath = path.resolve(__dirname, '../SparkLLM/models', modelName);
          
          console.log(`[Vite Proxy] Starting engine: ${exePath} -m ${modelPath}`);
          
          sparkProcess = spawn(exePath, ['-m', modelPath, '--port', '8080'], {
            stdio: 'inherit',
            detached: false
          });

          res.end(JSON.stringify({ status: 'Engine started' }));
        });
      }
      else if (req.url === '/api/stop-engine' && req.method === 'POST') {
        if (sparkProcess) {
          sparkProcess.kill();
          sparkProcess = null;
          res.end(JSON.stringify({ status: 'Engine stopped' }));
        } else {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Engine not running' }));
        }
      }
      else {
        next();
      }
    });

    server.httpServer.once('close', () => {
      if (sparkProcess) sparkProcess.kill();
    });
  }
});

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  plugins: [sparkPlugin()],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
