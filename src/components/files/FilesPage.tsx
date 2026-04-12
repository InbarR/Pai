import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ChevronRight, ChevronDown, Folder, FolderOpen, RefreshCw, ExternalLink, Link2, ChevronsDownUp, Search, X, FileText, Globe, Clock, User, Users, Mail, CheckSquare, File, Pin, PinOff } from 'lucide-react';
import { FileTypeIcon } from './FileIcons';

interface ScannedDoc {
  title: string;
  path: string;
  type: 'doc' | 'ppt' | 'xls' | 'pdf' | 'loop' | 'onenote' | 'visio' | 'url' | 'video' | 'image' | 'other';
  source: 'sharepoint' | 'onedrive' | 'local' | 'teams' | 'other';
  app?: string;
  owner?: string;
}

function extractContext(doc: ScannedDoc): string {
  const p = doc.path;
  try {
    if (p.startsWith('http')) {
      const u = new URL(p);
      const siteMatch = u.pathname.match(/\/(sites|teams)\/([^/]+)/i);
      if (siteMatch) return decodeURIComponent(siteMatch[2]).replace(/_/g, ' ');
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return decodeURIComponent(parts[parts.length - 2]);
    } else {
      const sep = p.includes('\\') ? '\\' : '/';
      const parts = p.split(sep).filter(Boolean);
      if (parts.length >= 2) return parts[parts.length - 2];
    }
  } catch {}
  return doc.source === 'onedrive' ? 'OneDrive' : doc.source === 'teams' ? 'Teams' : 'Other';
}

function groupByContext(docs: ScannedDoc[]): Record<string, ScannedDoc[]> {
  const groups: Record<string, ScannedDoc[]> = {};
  for (const doc of docs) {
    const key = extractContext(doc);
    if (!groups[key]) groups[key] = [];
    groups[key].push(doc);
  }
  return groups;
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(255, 200, 50, 0.3)', color: 'inherit', padding: '0 1px', borderRadius: 2 }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function FilesPage() {
  const [tab, setTab] = useState<'open' | 'recent'>('open');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: ScannedDoc } | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<ScannedDoc | null>(null);
  const [previewWidth, setPreviewWidth] = useState(280);
  const resizingRef = useRef(false);
  const qc = useQueryClient();

  const { data: pinnedFiles = [] } = useQuery({
    queryKey: ['pinned-files'],
    queryFn: () => api.get<ScannedDoc[]>('/files/pinned'),
  });

  const pinFile = useMutation({
    mutationFn: (doc: ScannedDoc) => api.post('/files/pin', { title: doc.title, path: doc.path, type: doc.type, source: doc.source }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pinned-files'] }),
  });

  const unpinFile = useMutation({
    mutationFn: (doc: ScannedDoc) => api.post('/files/unpin', { path: doc.path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pinned-files'] }),
  });

  const isPinned = (doc: ScannedDoc) => pinnedFiles.some((p: any) => p.path === doc.path);
  const togglePin = (doc: ScannedDoc) => isPinned(doc) ? unpinFile.mutate(doc) : pinFile.mutate(doc);

  const { data: fileConnections } = useQuery({
    queryKey: ['file-connections', selectedDoc?.title],
    queryFn: () => api.get<any>(`/files/connections?name=${encodeURIComponent(selectedDoc!.title)}&path=${encodeURIComponent(selectedDoc!.path)}`),
    enabled: !!selectedDoc,
    staleTime: 60_000,
  });

  const { data: openDocs = [], isLoading: loadingOpen, refetch: refetchOpen } = useQuery({
    queryKey: ['files-open'],
    queryFn: () => api.get<ScannedDoc[]>('/files/open'),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const { data: recentDocs = [], isLoading: loadingRecent, refetch: refetchRecent } = useQuery({
    queryKey: ['files-recent'],
    queryFn: () => api.get<ScannedDoc[]>('/files/recent'),
    staleTime: 60_000,
  });


  const docs = tab === 'open' ? openDocs : recentDocs;
  const loading = tab === 'open' ? loadingOpen : loadingRecent;
  const pinnedPaths = new Set(pinnedFiles.map((p: any) => p.path));
  const unpinnedDocs = docs.filter(d => !pinnedPaths.has(d.path));
  const filteredDocs = search.trim()
    ? unpinnedDocs.filter(d => d.title.toLowerCase().includes(search.toLowerCase()))
    : unpinnedDocs;
  const groups = groupByContext(filteredDocs);
  const groupNames = Object.keys(groups).sort();

  // Auto-expand all groups on load and when search is active
  useEffect(() => {
    if (groupNames.length > 0) {
      setExpanded(prev => prev.size === 0 || search.trim() ? new Set(groupNames) : prev);
    }
  }, [search, groupNames.join(',')]);

  const treeRef = useRef<HTMLDivElement>(null);

  // Build flat list of visible docs for keyboard navigation
  const visibleDocs = groupNames.flatMap(g => expanded.has(g) ? groups[g] : []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (visibleDocs.length === 0) return;
    const currentIdx = selectedDoc ? visibleDocs.findIndex(d => d.path === selectedDoc.path) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(currentIdx + 1, visibleDocs.length - 1);
      setSelectedDoc(visibleDocs[next]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(currentIdx - 1, 0);
      setSelectedDoc(visibleDocs[prev]);
    } else if (e.key === 'Enter' && selectedDoc) {
      e.preventDefault();
      openDoc(selectedDoc);
    }
  }, [tab, visibleDocs, selectedDoc]);

  useEffect(() => {
    const h = () => setContextMenu(null);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);

  const toggle = (name: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const openInBrowser = (doc: ScannedDoc) => { if (doc.path) api.post('/files/open', { url: doc.path, mode: 'browser' }); };
  const openInApp = (doc: ScannedDoc) => { if (doc.path) api.post('/files/open', { url: doc.path, mode: 'app' }); };
  const openDoc = openInBrowser; // default action (double-click)
  const copyLink = (doc: ScannedDoc) => { if (doc.path) navigator.clipboard.writeText(doc.path); };

  const getFileExtension = (path: string) => {
    const match = path.match(/\.(\w+)(?:\?|$)/);
    return match ? match[1].toUpperCase() : '';
  };

  const getSourceLabel = (doc: ScannedDoc) => {
    switch (doc.source) {
      case 'sharepoint': return 'SharePoint';
      case 'onedrive': return 'OneDrive';
      case 'teams': return 'Teams';
      case 'local': return 'Local';
      default: return doc.source || 'Unknown';
    }
  };

  return (
    <div className="files-split-layout">
    <div className="files-explorer" style={selectedDoc ? { flex: '1 1 0', minWidth: 0 } : undefined}>
      <div className="files-explorer-header">
        <div className="files-tabs">
          <button className={`files-tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
            Open ({openDocs.length})
          </button>
          <button className={`files-tab ${tab === 'recent' ? 'active' : ''}`} onClick={() => setTab('recent')}>
            Recent ({recentDocs.length})
          </button>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="ghost" style={{ padding: '2px 4px' }} title="Collapse all"
            onClick={() => setExpanded(new Set())}>
            <ChevronsDownUp size={13} />
          </button>
          <button className="ghost" style={{ padding: '2px 4px' }} onClick={() => { refetchOpen(); refetchRecent(); }} title="Refresh">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="fe-search">
        <Search size={12} className="fe-search-icon" />
        <input placeholder="Search files..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading && <div className="fe-loading">Scanning...</div>}

      <div className="fe-tree" ref={treeRef} tabIndex={0} onKeyDown={handleKeyDown}>
        {pinnedFiles.length > 0 && !search.trim() && (
          <>
            <div className="fe-section-label"><Pin size={10} /> Pinned</div>
            {pinnedFiles.map((doc: any, i: number) => (
              <div key={`pin-${i}`} className={`fe-row fe-file fe-pinned ${selectedDoc?.path === doc.path ? 'fe-selected' : ''}`}
                onClick={() => setSelectedDoc(doc)}
                onDoubleClick={() => openDoc(doc)}
                onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, doc }); }}>
                <div className="fe-file-icon"><FileTypeIcon type={doc.type} /></div>
                <span className="fe-name">{doc.title}</span>
                <button className="fe-pin-btn" onClick={e => { e.stopPropagation(); togglePin(doc); }} title="Unpin"><PinOff size={11} /></button>
              </div>
            ))}
            <div className="fe-section-divider" />
          </>
        )}
        {filteredDocs.map((doc, i) => (
          <div key={i} className={`fe-row fe-file ${selectedDoc?.path === doc.path ? 'fe-selected' : ''}`}
            onClick={() => setSelectedDoc(doc)}
            onDoubleClick={() => openDoc(doc)}
            onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, doc }); }}
            title={`${doc.title}\n${doc.source} · ${doc.type.toUpperCase()}\n${doc.path}`}>
            <div className="fe-file-icon"><FileTypeIcon type={doc.type} /></div>
            <span className="fe-name">{search.trim() ? highlightMatch(doc.title, search) : doc.title}</span>
          </div>
        ))}
        {filteredDocs.length === 0 && pinnedFiles.length === 0 && !loading && (
          <div className="fe-empty">No files found</div>
        )}
      </div>

      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { openInBrowser(contextMenu.doc); setContextMenu(null); }}><Globe size={14} /> Open in Browser</button>
          <button onClick={() => { openInApp(contextMenu.doc); setContextMenu(null); }}><ExternalLink size={14} /> Open in App</button>
          <button onClick={() => { copyLink(contextMenu.doc); setContextMenu(null); }}><Link2 size={14} /> Copy Link</button>
          <hr />
          <button onClick={() => { togglePin(contextMenu.doc); setContextMenu(null); }}>
            {isPinned(contextMenu.doc) ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin</>}
          </button>
        </div>
      )}
    </div>

    {selectedDoc && (<>
      <div className="fe-resize-handle" onMouseDown={e => {
        e.preventDefault();
        resizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const onMove = (ev: MouseEvent) => {
          if (!resizingRef.current) return;
          const newWidth = Math.max(200, Math.min(500, window.innerWidth - ev.clientX));
          setPreviewWidth(newWidth);
        };
        const onUp = () => {
          resizingRef.current = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }} />
      <div className="fe-preview-panel" style={{ width: previewWidth }}>
        <div className="fe-preview-header">
          <span style={{ fontWeight: 600, fontSize: 13 }}>Preview</span>
          <button className="ghost" onClick={() => setSelectedDoc(null)} style={{ padding: 2 }}>
            <X size={14} />
          </button>
        </div>
        <div className="fe-preview-content">
          <div className="fe-preview-icon">
            <FileTypeIcon type={selectedDoc.type} />
          </div>
          <h3 className="fe-preview-title">{selectedDoc.title}</h3>

          <div className="fe-preview-meta">
            {selectedDoc.type !== 'other' && (
              <div className="fe-preview-meta-row">
                <FileText size={13} />
                <span>{getFileExtension(selectedDoc.path) || selectedDoc.type.toUpperCase()} file</span>
              </div>
            )}
            <div className="fe-preview-meta-row">
              <Globe size={13} />
              <span>{getSourceLabel(selectedDoc)}</span>
            </div>
            {selectedDoc.owner && (
              <div className="fe-preview-meta-row">
                <User size={13} />
                <span>{selectedDoc.owner}</span>
              </div>
            )}
            {selectedDoc.app && (
              <div className="fe-preview-meta-row">
                <Clock size={13} />
                <span>{selectedDoc.app}</span>
              </div>
            )}
          </div>

          <div className="fe-preview-path">
            <span className="fe-preview-path-label">Location</span>
            <a className="fe-preview-path-value" href={selectedDoc.path} target="_blank" rel="noopener noreferrer" title={selectedDoc.path}>
              {decodeURIComponent(selectedDoc.path)}
            </a>
          </div>

          <div className="fe-preview-actions">
            <button className="btn-sm" onClick={() => openInBrowser(selectedDoc)}>
              <Globe size={13} /> Browser
            </button>
            <button className="btn-sm" onClick={() => openInApp(selectedDoc)}>
              <ExternalLink size={13} /> App
            </button>
            <button className="btn-sm ghost" onClick={() => copyLink(selectedDoc)}>
              <Link2 size={13} /> Copy
            </button>
          </div>

          {fileConnections && (fileConnections.connections.people.length > 0 || fileConnections.connections.emails.length > 0 || fileConnections.connections.tasks.length > 0) && (
            <div className="fe-preview-connections">
              <div className="fe-preview-section-title">Connections</div>
              {fileConnections.connections.people.length > 0 && (
                <div className="fe-conn-group">
                  <div className="fe-conn-group-header"><Users size={12} /> People</div>
                  {fileConnections.connections.people.slice(0, 3).map((p: any, i: number) => (
                    <div key={i} className="fe-conn-item">
                      <span className="fe-conn-name">{p.name}</span>
                      <span className="fe-conn-reason">{p.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {fileConnections.connections.emails.length > 0 && (
                <div className="fe-conn-group">
                  <div className="fe-conn-group-header"><Mail size={12} /> Emails</div>
                  {fileConnections.connections.emails.slice(0, 3).map((e: any, i: number) => (
                    <div key={i} className="fe-conn-item">
                      <span className="fe-conn-name">{e.name}</span>
                      <span className="fe-conn-reason">{e.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {fileConnections.connections.tasks.length > 0 && (
                <div className="fe-conn-group">
                  <div className="fe-conn-group-header"><CheckSquare size={12} /> Tasks</div>
                  {fileConnections.connections.tasks.slice(0, 3).map((t: any, i: number) => (
                    <div key={i} className="fe-conn-item">
                      <span className="fe-conn-name">{t.name}</span>
                      <span className="fe-conn-reason">{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
              {fileConnections.connections.relatedFiles.length > 0 && (
                <div className="fe-conn-group">
                  <div className="fe-conn-group-header"><File size={12} /> Related Files</div>
                  {fileConnections.connections.relatedFiles.slice(0, 3).map((f: any, i: number) => (
                    <div key={i} className="fe-conn-item">
                      <span className="fe-conn-name">{f.name}</span>
                      <span className="fe-conn-reason">{f.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>)}
    </div>
  );
}
