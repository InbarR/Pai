import fs from 'fs';
import path from 'path';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GITHUB_BASE_URL = 'https://github.com';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
const COPILOT_VERSION = '0.26.7';
const VSCODE_VERSION = '1.106.3';
const API_VERSION = '2025-04-01';

let githubToken: string | null = null;
let copilotToken: { token: string; expires_at: number } | null = null;

// Store token in a local file for persistence
const tokenPath = path.join(
  process.env.LOCALAPPDATA || process.env.HOME || '.',
  'PersonalAssistant', 'gh_token.json'
);

interface ChatMessage {
  role: string;
  content: string;
}

// --- Token management ---

function loadStoredToken(): string | null {
  try {
    if (fs.existsSync(tokenPath)) {
      const data = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
      if (data.token && data.token.length >= 20) return data.token;
    }
  } catch { }
  return null;
}

function saveToken(token: string) {
  try {
    const dir = path.dirname(tokenPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify({ token }), 'utf-8');
  } catch { }
}

export function getGitHubToken(): string | null {
  if (githubToken) return githubToken;
  githubToken = loadStoredToken();
  return githubToken;
}

export function isAuthenticated(): boolean {
  return !!getGitHubToken();
}

// --- Device code auth flow ---

export async function startDeviceCodeAuth(): Promise<{
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
}> {
  const res = await fetch(`${GITHUB_BASE_URL}/login/device/code`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user user:email',
    }),
  });
  if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
  return res.json();
}

export async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  let sleepMs = (interval + 1) * 1000;

  while (true) {
    await new Promise(r => setTimeout(r, sleepMs));

    const res = await fetch(`${GITHUB_BASE_URL}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = await res.json() as any;

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { sleepMs += 5000; continue; }
    if (data.error) throw new Error(`Auth error: ${data.error}`);
    if (data.access_token) {
      githubToken = data.access_token;
      saveToken(data.access_token);
      return data.access_token;
    }
  }
}

// --- Copilot token ---

async function ensureCopilotToken(): Promise<string> {
  if (copilotToken && copilotToken.expires_at > Date.now() / 1000) {
    return copilotToken.token;
  }

  if (!githubToken) {
    githubToken = loadStoredToken();
    if (!githubToken) throw new Error('Not authenticated with GitHub');
  }

  const endpoints = ['/copilot_internal/v2/token', '/copilot_internal/token'];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${GITHUB_API_BASE_URL}${endpoint}`, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/json',
          'editor-version': `vscode/${VSCODE_VERSION}`,
          'editor-plugin-version': `copilot-chat/${COPILOT_VERSION}`,
          'user-agent': `GitHubCopilotChat/${COPILOT_VERSION}`,
          'x-github-api-version': API_VERSION,
        },
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data.token) {
          copilotToken = { token: data.token, expires_at: data.expires_at };
          return data.token;
        }
      }
    } catch { }
  }

  throw new Error('Failed to get Copilot token. Ensure you have a Copilot subscription.');
}

// --- Models ---

const FALLBACK_MODELS = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5.4',
  'claude-sonnet-4.5', 'claude-sonnet-4', 'claude-opus-4.5',
  'gemini-2.5-pro',
];

export async function getModels(): Promise<string[]> {
  try {
    const token = await ensureCopilotToken();

    const res = await fetch(`${COPILOT_BASE_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'copilot-integration-id': 'vscode-chat',
        'editor-version': `vscode/${VSCODE_VERSION}`,
        'editor-plugin-version': `copilot-chat/${COPILOT_VERSION}`,
        'user-agent': `GitHubCopilotChat/${COPILOT_VERSION}`,
        'x-github-api-version': API_VERSION,
      },
    });

    if (!res.ok) return FALLBACK_MODELS;
    const data = await res.json() as any;

    if (data.data && Array.isArray(data.data)) {
      const models = data.data
        .map((m: any) => m.id)
        .filter((id: string) => !!id);
      return models.length > 0 ? models : FALLBACK_MODELS;
    }
  } catch { }
  return FALLBACK_MODELS;
}

// --- Chat completion ---

export async function chatCompletion(
  messages: ChatMessage[],
  model: string = 'gpt-4o',
  temperature: number = 0.7
): Promise<string> {
  const token = await ensureCopilotToken();

  const res = await fetch(`${COPILOT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'copilot-integration-id': 'vscode-chat',
      'editor-version': `vscode/${VSCODE_VERSION}`,
      'editor-plugin-version': `copilot-chat/${COPILOT_VERSION}`,
      'user-agent': `GitHubCopilotChat/${COPILOT_VERSION}`,
      'openai-intent': 'conversation-panel',
      'x-github-api-version': API_VERSION,
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({ messages, model, temperature, stream: false }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Copilot API error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// Streaming helper: forwards content chunks to onChunk and returns the full text.
export async function chatCompletionStreamed(
  messages: ChatMessage[],
  model: string = 'gpt-4o',
  onChunk: (text: string) => void,
  temperature: number = 0.7,
): Promise<string> {
  const stream = await chatCompletionStream(messages, model, temperature);
  if (!stream) throw new Error('No stream returned from Copilot');

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch { /* ignore non-JSON keepalives */ }
    }
  }
  return full;
}

export async function chatCompletionStream(
  messages: ChatMessage[],
  model: string = 'gpt-4o',
  temperature: number = 0.7
): Promise<ReadableStream<Uint8Array> | null> {
  const token = await ensureCopilotToken();

  const res = await fetch(`${COPILOT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'copilot-integration-id': 'vscode-chat',
      'editor-version': `vscode/${VSCODE_VERSION}`,
      'editor-plugin-version': `copilot-chat/${COPILOT_VERSION}`,
      'user-agent': `GitHubCopilotChat/${COPILOT_VERSION}`,
      'openai-intent': 'conversation-panel',
      'x-github-api-version': API_VERSION,
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({ messages, model, temperature, stream: true }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Copilot API error ${res.status}: ${text}`);
  }

  return res.body;
}
