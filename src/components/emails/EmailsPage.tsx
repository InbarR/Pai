import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ImportantEmail } from '../../api/types';
import { Zap, Search, CheckCircle, ListPlus, X, ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';

type EmailExt = ImportantEmail & { aiCategory?: string; aiPriority?: string; aiSummary?: string; aiSuggestedAction?: string };

interface FolderNode {
  name: string;
  path: string;
  count: number;
  unread: number;
  children: FolderNode[];
}

const categoryColors: Record<string, string> = {
  action_required: '#ef4444', fyi: '#3b82f6', newsletter: '#8b5cf6',
  automated: '#6b7280', social: '#22c55e',
};
const categoryLabels: Record<string, string> = {
  action_required: 'Action Required', fyi: 'FYI', newsletter: 'Newsletter',
  automated: 'Automated', social: 'Social',
};

function FolderTree({ node, depth, selectedPath, onSelect }: {
  node: FolderNode; depth: number; selectedPath: string | null;
  onSelect: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedPath === node.path;
  const folderName = node.name || 'Inbox';

  return (
    <div>
      <div
        className={`folder-item ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.path, folderName)}
      >
        {hasChildren ? (
          <span className="folder-toggle" onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : <span style={{ width: 12 }} />}
        {isSelected ? <FolderOpen size={13} /> : <Folder size={13} />}
        <span className="folder-name truncate">{folderName}</span>
        {node.unread > 0 && <span className="folder-unread">{node.unread}</span>}
      </div>
      {expanded && hasChildren && node.children.map((child, i) => (
        <FolderTree key={i} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function EmailsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('Synced');

  const { data: authStatus } = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => api.get<{ authenticated: boolean; email: string | null; hint?: string }>('/auth/status'),
  });

  const { data: folderTree } = useQuery({
    queryKey: ['email-folders'],
    queryFn: () => api.get<FolderNode>('/emails/folders'),
  });

  // When a folder is selected, fetch emails live from Outlook. Otherwise show synced DB emails.
  const { data: folderEmails = [] } = useQuery({
    queryKey: ['folder-emails', selectedFolder],
    queryFn: () => api.get<any[]>(`/emails/folder/${encodeURIComponent(selectedFolder!)}`),
    enabled: !!selectedFolder,
  });

  const { data: syncedEmails = [], isLoading } = useQuery({
    queryKey: ['emails'],
    queryFn: () => api.get<EmailExt[]>('/emails'),
  });

  const allEmails: any[] = selectedFolder ? folderEmails : syncedEmails;

  const { data: emailBody } = useQuery({
    queryKey: ['email-body', selectedId],
    queryFn: () => api.get<{ htmlBody?: string; body?: string; to?: string; cc?: string }>(`/emails/${selectedId}/body`),
    enabled: !!selectedId && !selectedFolder, // only for synced emails (have DB id)
  });

  // For folder emails, get body by entry ID directly
  const selectedEmail = allEmails.find((e: any) => (e.id ?? e.graphMessageId) === selectedId);

  let emails = allEmails;
  if (search) {
    const q = search.toLowerCase();
    emails = emails.filter((e: any) =>
      (e.subject || '').toLowerCase().includes(q) ||
      (e.fromName || '').toLowerCase().includes(q) ||
      (e.bodyPreview || '').toLowerCase().includes(q)
    );
  }

  const syncMutation = useMutation({
    mutationFn: () => api.post<{ synced: number }>('/emails/sync'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ['emails'] }), 5000);
    },
  });

  const actionMutation = useMutation({
    mutationFn: (id: number) => api.post(`/emails/${id}/toggle-actioned`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  });

  const toTaskMutation = useMutation({
    mutationFn: (id: number) => api.post(`/emails/${id}/to-task`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });

  const handleFolderSelect = (path: string, name: string) => {
    setSelectedFolder(path);
    setFolderName(name);
    setSelectedId(null);
  };

  return (
    <div className="emails-layout">
      {/* Folder tree */}
      <div className="email-folders-panel">
        <div style={{ padding: '10px 10px 6px' }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>Folders</span>
        </div>
        <div
          className={`folder-item ${selectedFolder === null ? 'active' : ''}`}
          style={{ paddingLeft: 8 }}
          onClick={() => { setSelectedFolder(null); setFolderName('Synced'); setSelectedId(null); }}
        >
          <span style={{ width: 12 }} />
          <Folder size={13} />
          <span className="folder-name">Synced</span>
          <span className="folder-unread">{syncedEmails.length}</span>
        </div>
        {folderTree && <FolderTree node={folderTree} depth={0} selectedPath={selectedFolder} onSelect={handleFolderSelect} />}
      </div>

      {/* Email list */}
      <div className="emails-list-panel">
        <div className="emails-list-header">
          <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>{folderName}</h2>
            <button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || !authStatus?.authenticated}
              style={{ padding: '3px 10px', fontSize: 11 }}>
              {syncMutation.isPending ? 'Syncing...' : 'Sync'}
            </button>
          </div>
          <div className="notes-search">
            <Search size={14} className="notes-search-icon" />
            <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12 }} />
          </div>
        </div>
        <div className="emails-list-scroll">
          {emails.map((email: any, i: number) => {
            const emailId = email.id ?? email.graphMessageId ?? i;
            return (
              <div
                key={emailId}
                className={`email-list-item ${selectedId === emailId ? 'active' : ''} ${email.isActioned ? 'actioned' : ''}`}
                onClick={() => setSelectedId(emailId)}
              >
                <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
                  {email.aiCategory && email.aiCategory !== 'fyi' && (
                    <span className="email-ai-badge" style={{
                      background: (categoryColors[email.aiCategory] || '#666') + '22',
                      color: categoryColors[email.aiCategory] || '#666',
                    }}>
                      {categoryLabels[email.aiCategory] || email.aiCategory}
                    </span>
                  )}
                  <span className="email-list-from truncate">{email.fromName}</span>
                  <span className="email-list-date">{email.receivedAt ? new Date(email.receivedAt).toLocaleDateString() : ''}</span>
                </div>
                <div className="email-list-subject truncate">{email.subject}</div>
                <div className="email-list-preview truncate">{email.aiSummary || email.bodyPreview}</div>
              </div>
            );
          })}
          {emails.length === 0 && !isLoading && (
            <div className="text-muted text-small" style={{ padding: 16, textAlign: 'center' }}>
              {search ? 'No matches' : 'No emails'}
            </div>
          )}
        </div>
      </div>

      {/* Reading pane */}
      <div className="email-reading-pane">
        {selectedEmail ? (
          <>
            <div className="email-reading-header">
              <div className="flex justify-between items-center">
                <h3 className="email-reading-subject">{selectedEmail.subject}</h3>
                <button className="ghost" onClick={() => setSelectedId(null)}><X size={16} /></button>
              </div>
              <div className="email-reading-meta">
                <div><strong>{selectedEmail.fromName}</strong></div>
                <div className="text-xs text-muted">{selectedEmail.receivedAt ? new Date(selectedEmail.receivedAt).toLocaleString() : ''}</div>
                {emailBody?.to && <div className="text-xs text-muted">To: {emailBody.to}</div>}
              </div>
              {!selectedFolder && (
                <div className="email-reading-actions">
                  <button className="secondary" onClick={() => actionMutation.mutate(selectedEmail.id)}>
                    <CheckCircle size={14} /> {selectedEmail.isActioned ? 'Reopen' : 'Done'}
                  </button>
                  <button className="secondary" onClick={() => toTaskMutation.mutate(selectedEmail.id)}>
                    <ListPlus size={14} /> Task
                  </button>
                </div>
              )}
            </div>
            <div className="email-reading-body">
              {emailBody?.htmlBody ? (
                <iframe
                  srcDoc={`<html><head><style>
                    * { background-color: #0a0a0f !important; color: #e0e0e0 !important; border-color: #2a2a3a !important; }
                    body { font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 14px; padding: 16px; line-height: 1.6; }
                    a { color: #6366f1 !important; }
                    img { max-width: 100%; height: auto; filter: brightness(0.9); }
                  </style></head><body>${emailBody.htmlBody}</body></html>`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  sandbox="allow-same-origin"
                  title="Email"
                />
              ) : selectedEmail.bodyPreview ? (
                <pre className="email-reading-text">{selectedEmail.bodyPreview}</pre>
              ) : (
                <div className="text-muted" style={{ padding: 20 }}>Select a synced email to see full content</div>
              )}
            </div>
          </>
        ) : (
          <div className="email-reading-empty">Select an email to read</div>
        )}
      </div>
    </div>
  );
}
