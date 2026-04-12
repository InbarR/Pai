import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Settings, Keyboard, Save, Bot, Trash2, Brain } from 'lucide-react';

declare global {
  interface Window {
    pai?: {
      isElectron: boolean;
      getSettings: () => Promise<any>;
      saveSettings: (s: any) => Promise<any>;
    };
    brian?: {
      isElectron: boolean;
      getSettings: () => Promise<any>;
      saveSettings: (s: any) => Promise<any>;
    };
  }
}


export default function SettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [shortcut, setShortcut] = useState('Ctrl+2');
  const [windowMode, setWindowMode] = useState('companion');
  const [saved, setSaved] = useState(false);

  // Assistant settings
  const { data: assistantSettings } = useQuery({
    queryKey: ['assistant-settings'],
    queryFn: () => api.get<any>('/chat/assistant-settings'),
  });

  const [userName, setUserName] = useState('');
  const [assistantName, setAssistantName] = useState('Brian');
  const [tone, setTone] = useState('friendly');
  const [language, setLanguage] = useState('auto');
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    if (assistantSettings) {
      setUserName(assistantSettings.user_name || '');
      setAssistantName(assistantSettings.assistant_name || 'Brian');
      setTone(assistantSettings.assistant_tone || 'friendly');
      setLanguage(assistantSettings.assistant_language || 'auto');
      setInstructions(assistantSettings.assistant_instructions || '');
    }
  }, [assistantSettings]);

  const saveAssistant = useMutation({
    mutationFn: () => api.put('/chat/assistant-settings', {
      user_name: userName,
      assistant_name: assistantName,
      assistant_tone: tone,
      assistant_language: language,
      assistant_instructions: instructions,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assistant-settings'] });
      setAssistantSaved(true);
      setTimeout(() => setAssistantSaved(false), 2000);
    },
  });
  const [assistantSaved, setAssistantSaved] = useState(false);

  // Memories
  const { data: memories = [] } = useQuery({
    queryKey: ['chat-memories'],
    queryFn: () => api.get<any[]>('/chat/memories'),
  });

  const deleteMemory = useMutation({
    mutationFn: (key: string) => api.delete(`/chat/memories/${encodeURIComponent(key)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-memories'] }),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { navigate('/'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  useEffect(() => {
    if (window.brian?.isElectron) {
      window.brian.getSettings().then(s => {
        setShortcut(s.shortcut || 'Ctrl+2');
        setWindowMode(s.windowMode || 'companion');
      });
    }
  }, []);

  const handleSave = async () => {
    if (window.brian?.isElectron) {
      await window.brian.saveSettings({ shortcut, windowMode });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <div className="section-header">
        <h2><Settings size={22} style={{ marginRight: 8, verticalAlign: -4 }} /> Settings</h2>
      </div>

      {/* Assistant Customization */}
      <div className="card-form">
        <div style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={16} /> Assistant Personality
        </div>

        <div className="form-row" style={{ marginBottom: 10 }}>
          <label style={{ width: 100, fontSize: 13 }}>Assistant name</label>
          <input value={assistantName} onChange={e => setAssistantName(e.target.value)} placeholder="Brian" style={{ flex: 1 }} />
        </div>
        <div className="form-row" style={{ marginBottom: 10 }}>
          <label style={{ width: 100, fontSize: 13 }}>Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value)} style={{ flex: 1 }}>
            <option value="friendly">Friendly</option>
            <option value="professional">Professional</option>
            <option value="casual">Casual</option>
            <option value="concise">Concise & direct</option>
            <option value="humorous">Humorous</option>
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Custom instructions</label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="e.g. Always suggest next actions. Prioritize security topics. Use bullet points."
            rows={3}
            style={{ width: '100%', fontSize: 13, resize: 'vertical' }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => saveAssistant.mutate()}>
            <Save size={14} /> Save
          </button>
          {assistantSaved && <span className="text-small" style={{ color: 'var(--green)' }}>Saved!</span>}
        </div>
      </div>

      {/* Memory Management */}
      <div className="card-form" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={16} /> Memory
        </div>
        <p className="text-small text-muted" style={{ marginBottom: 10 }}>
          Things Brian remembers about you across conversations.
        </p>
        {memories.length === 0 && (
          <div className="text-small text-muted">No memories yet. Chat with Brian and tell it about yourself!</div>
        )}
        {memories.map((m: any) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="text-small" style={{ color: 'var(--text-muted)', width: 70, flexShrink: 0 }}>{m.category}</span>
            <span className="text-small flex-1"><strong>{m.key}:</strong> {m.value}</span>
            <button className="ghost" onClick={() => deleteMemory.mutate(m.key)} style={{ padding: 2 }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Window & Shortcut */}
      <div className="card-form" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Keyboard size={16} /> Window & Shortcut
        </div>

        <div className="form-row" style={{ marginBottom: 10 }}>
          <label style={{ width: 100, fontSize: 13 }}>Window mode</label>
          <select value={windowMode} onChange={e => setWindowMode(e.target.value)} style={{ flex: 1 }}>
            <option value="companion">Companion (centered)</option>
            <option value="sidecar">Sidecar (docked right)</option>
          </select>
        </div>

        <div className="form-row" style={{ marginBottom: 12 }}>
          <label style={{ width: 100, fontSize: 13 }}>Shortcut</label>
          <input
            value={shortcut}
            onChange={e => setShortcut(e.target.value)}
            placeholder="e.g. Ctrl+2"
            style={{ flex: 1, fontSize: 14, fontWeight: 600 }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleSave}>
            <Save size={14} /> Save
          </button>
          {saved && <span className="text-small" style={{ color: 'var(--green)' }}>Saved! Shortcut updated.</span>}
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="card-form" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Keyboard size={16} /> Keyboard Shortcuts
        </div>
        <div className="shortcuts-list">
          <div className="shortcut-group-title">Global</div>
          <div className="shortcut-row"><kbd>{shortcut}</kbd><span>Toggle Brian window</span></div>
          <div className="shortcut-row"><kbd>Escape</kbd><span>Switch to sidecar / go back</span></div>

          <div className="shortcut-group-title">Chat</div>
          <div className="shortcut-row"><kbd>Ctrl+N</kbd><span>New chat session</span></div>
          <div className="shortcut-row"><kbd>Ctrl+H</kbd><span>Toggle chat history</span></div>
          <div className="shortcut-row"><kbd>Enter</kbd><span>Send message</span></div>
          <div className="shortcut-row"><kbd>Shift+Enter</kbd><span>New line in message</span></div>
          <div className="shortcut-row"><kbd>&uarr;</kbd><span>Previous prompt (when input empty)</span></div>
          <div className="shortcut-row"><kbd>&darr;</kbd><span>Next prompt (when browsing history)</span></div>

          <div className="shortcut-group-title">Navigation</div>
          <div className="shortcut-row"><kbd>Ctrl+Shift+P</kbd><span>Command palette</span></div>
          <div className="shortcut-row"><kbd>Alt+1</kbd><span>Dashboard</span></div>
          <div className="shortcut-row"><kbd>Alt+2</kbd><span>Notes</span></div>
          <div className="shortcut-row"><kbd>Alt+3</kbd><span>Reminders</span></div>
          <div className="shortcut-row"><kbd>Alt+4</kbd><span>Emails</span></div>
          <div className="shortcut-row"><kbd>Alt+5</kbd><span>Files</span></div>
          <div className="shortcut-row"><kbd>Alt+6</kbd><span>People</span></div>
          <div className="shortcut-row"><kbd>Alt+F</kbd><span>Toggle sidecar mode</span></div>

          <div className="shortcut-group-title">Files</div>
          <div className="shortcut-row"><kbd>&uarr; / &darr;</kbd><span>Navigate files</span></div>
          <div className="shortcut-row"><kbd>Enter</kbd><span>Open selected file</span></div>

          <div className="shortcut-group-title">Window</div>
          <div className="shortcut-row"><kbd>&#x2013;</kbd><span>Minimize to taskbar</span></div>
          <div className="shortcut-row"><kbd>&#x2715;</kbd><span>Close to system tray</span></div>
        </div>
      </div>

      <div className="card-form" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>About</div>
        <div className="text-small text-muted">
          <strong>Brian</strong> — Your Second Brain<br />
          Built with React, Electron, Express, SQLite<br />
          AI powered by GitHub Copilot<br /><br />
          &copy; Inbar Rotem 314
        </div>
      </div>
    </div>
  );
}
