import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let mcpProcess: ChildProcessWithoutNullStreams | null = null;
let requestId = 0;
const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
let buffer = '';
let initialized = false;

function startMcp(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mcpProcess && initialized) { resolve(); return; }

    console.log('[WorkIQ] Starting MCP server...');
    mcpProcess = spawn('npx', ['-y', '@microsoft/workiq', 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    mcpProcess.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      while (true) {
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx === -1) break;
        const line = buffer.substring(0, newlineIdx).trim();
        buffer = buffer.substring(newlineIdx + 1);
        if (!line) continue;

        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pendingRequests.has(msg.id)) {
            const pending = pendingRequests.get(msg.id)!;
            pendingRequests.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else pending.resolve(msg.result);
          }
        } catch {}
      }
    });

    mcpProcess.stderr.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.log('[WorkIQ stderr]', text.substring(0, 200));
    });

    mcpProcess.on('exit', (code) => {
      console.log(`[WorkIQ] MCP process exited with code ${code}`);
      mcpProcess = null;
      initialized = false;
    });

    // Initialize the MCP protocol
    const initId = ++requestId;
    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'pai', version: '1.0.0' },
      },
    });

    pendingRequests.set(initId, {
      resolve: () => {
        // Send initialized notification
        mcpProcess?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        initialized = true;
        console.log('[WorkIQ] MCP initialized');
        // Accept EULA automatically
        const eulaId = ++requestId;
        const eulaMsg = JSON.stringify({ jsonrpc: '2.0', id: eulaId, method: 'tools/call', params: { name: 'accept_eula', arguments: {} } });
        pendingRequests.set(eulaId, {
          resolve: () => console.log('[WorkIQ] EULA accepted'),
          reject: () => console.log('[WorkIQ] EULA accept failed (may already be accepted)'),
        });
        mcpProcess?.stdin.write(eulaMsg + '\n');
        resolve();
      },
      reject,
    });

    mcpProcess.stdin.write(initMsg + '\n');

    // Timeout
    setTimeout(() => {
      if (!initialized) {
        pendingRequests.delete(initId);
        reject(new Error('WorkIQ MCP init timeout'));
      }
    }, 30000);
  });
}

function callTool(name: string, args: Record<string, any>): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      await startMcp();
    } catch (err) {
      return reject(err);
    }

    if (!mcpProcess) return reject(new Error('MCP not running'));

    const id = ++requestId;
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    pendingRequests.set(id, { resolve, reject });
    mcpProcess.stdin.write(msg + '\n');

    // 20s timeout
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('WorkIQ tool call timeout'));
      }
    }, 20000);
  });
}

export async function askWorkIQ(query: string): Promise<string> {
  try {
    const result = await callTool('ask_work_iq', { query });
    console.log('[WorkIQ] Raw result:', JSON.stringify(result).substring(0, 500));
    // MCP tool results are in content array
    if (result?.content && Array.isArray(result.content)) {
      return result.content.map((c: any) => c.text || '').join('\n');
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err: any) {
    console.error('[WorkIQ] Error:', err.message);
    return `WorkIQ error: ${err.message}`;
  }
}

export function isWorkIQAvailable(): boolean {
  return true; // Always available since npx will fetch it
}
