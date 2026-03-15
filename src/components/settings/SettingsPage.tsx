import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Keyboard, Save } from 'lucide-react';

declare global {
  interface Window {
    pai?: {
      isElectron: boolean;
      getSettings: () => Promise<any>;
      saveSettings: (s: any) => Promise<any>;
    };
  }
}


export default function SettingsPage() {
  const navigate = useNavigate();
  const [shortcut, setShortcut] = useState('Ctrl+2');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { navigate('/'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  useEffect(() => {
    if (window.pai?.isElectron) {
      window.pai.getSettings().then(s => {
        setShortcut(s.shortcut || 'Ctrl+2');
      });
    }
  }, []);

  const handleSave = async () => {
    const sc = shortcut;
    if (window.pai?.isElectron) {
      await window.pai.saveSettings({ shortcut: sc });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <div className="section-header">
        <h2><Settings size={22} style={{ marginRight: 8, verticalAlign: -4 }} /> Settings</h2>
      </div>

      <div className="card-form">
        <div style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Keyboard size={16} /> Global Shortcut
        </div>
        <p className="text-small text-muted" style={{ marginBottom: 12 }}>
          Press this shortcut anywhere to toggle Pai. Requires Electron (desktop app).
        </p>

        <div className="form-row" style={{ marginBottom: 12 }}>
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
          {!window.pai?.isElectron && (
            <span className="text-small text-muted">Settings apply in the Electron desktop app only.</span>
          )}
        </div>
      </div>

      <div className="card-form" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>About</div>
        <div className="text-small text-muted">
          <strong>Pai</strong> — Personal AI Assistant<br />
          Built with React, Electron, Express, SQLite<br />
          AI powered by GitHub Copilot<br /><br />
          &copy; Inbar Rotem 314
        </div>
      </div>
    </div>
  );
}
