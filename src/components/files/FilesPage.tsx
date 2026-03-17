import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Search, RefreshCw, ExternalLink, Link2, BookOpen } from 'lucide-react';
import { FileTypeIcon } from './FileIcons';

interface ScannedDoc {
  title: string;
  path: string;
  type: 'doc' | 'ppt' | 'xls' | 'pdf' | 'other';
  source: 'sharepoint' | 'onedrive' | 'local' | 'teams' | 'other';
  app?: string;
  owner?: string;
}

const typeColors: Record<string, string> = {
  doc: '#185ABD', xls: '#107C41', ppt: '#C43E1C', pdf: '#D93025', other: '#666',
};

const sourceLabels: Record<string, string> = {
  sharepoint: 'SharePoint', onedrive: 'OneDrive', local: 'Local', teams: 'Teams', other: 'Other',
};

export default function FilesPage() {
  const [tab, setTab] = useState<'open' | 'recent'>('open');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

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

  // Close context menu on click
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const docs = tab === 'open' ? openDocs : recentDocs;
  const loading = tab === 'open' ? loadingOpen : loadingRecent;

  let filtered = typeFilter !== 'all' ? docs.filter(d => d.type === typeFilter) : docs;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(d => d.title.toLowerCase().includes(q) || (d.owner || '').toLowerCase().includes(q));
  }

  const openDoc = (doc: ScannedDoc) => {
    if (doc.path) api.post('/files/open', { url: doc.path });
  };

  const copyLink = (doc: ScannedDoc) => {
    if (doc.path) navigator.clipboard.writeText(doc.path);
  };

  const handleClick = (idx: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedIndices(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
    } else {
      setSelectedIndices(new Set([idx]));
    }
  };

  const handleContextMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    if (!selectedIndices.has(idx)) setSelectedIndices(new Set([idx]));
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const selectedDocs = [...selectedIndices].map(i => filtered[i]).filter(Boolean);

  return (
    <div>
      <div className="section-header">
        <h2>Files</h2>
        <button className="secondary" onClick={() => { refetchOpen(); refetchRecent(); }}
          style={{ padding: '4px 12px', fontSize: 12 }}>
          <RefreshCw size={13} /> Scan
        </button>
      </div>

      <div className="email-filters" style={{ marginBottom: 12 }}>
        <button className={`email-filter ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
          Open Now ({openDocs.length})
        </button>
        <button className={`email-filter ${tab === 'recent' ? 'active' : ''}`} onClick={() => setTab('recent')}>
          Recent ({recentDocs.length})
        </button>
      </div>

      <div className="notes-search" style={{ marginBottom: 10 }}>
        <Search size={14} className="notes-search-icon" />
        <input placeholder="Search files..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="email-filters" style={{ marginBottom: 16 }}>
        {['all', 'doc', 'xls', 'ppt', 'pdf'].map(t => (
          <button
            key={t}
            className={`email-filter ${typeFilter === t ? 'active' : ''}`}
            onClick={() => setTypeFilter(t)}
            style={t !== 'all' ? { color: typeColors[t] } : {}}
          >
            {t === 'all' ? `All (${docs.length})`
              : `${t === 'doc' ? 'Word' : t === 'xls' ? 'Excel' : t === 'ppt' ? 'PPT' : 'PDF'} (${docs.filter(d => d.type === t).length})`}
          </button>
        ))}
      </div>

      {loading && <div className="text-muted">Scanning...</div>}

      <div className="files-grid">
        {filtered.map((doc, i) => (
          <div
            key={`${doc.title}-${i}`}
            className={`file-card ${selectedIndices.has(i) ? 'selected' : ''}`}
            onClick={e => handleClick(i, e)}
            onDoubleClick={() => openDoc(doc)}
            onContextMenu={e => handleContextMenu(e, i)}
          >
            <FileTypeIcon type={doc.type} />
            <div className="file-info">
              <div className="file-title truncate">{doc.title}</div>
              <div className="file-meta">
                <span className="file-source">{sourceLabels[doc.source] || doc.source}</span>
                {doc.owner && <span>• {doc.owner}</span>}
                {doc.app && <span>• {doc.app}</span>}
              </div>
            </div>
            <ExternalLink size={14} className="file-open-icon" />
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { selectedDocs.forEach(d => openDoc(d)); setContextMenu(null); }}>
            <ExternalLink size={14} /> Open{selectedDocs.length > 1 ? ` (${selectedDocs.length})` : ''}
          </button>
          {selectedDocs.length === 1 && (
            <button onClick={() => { copyLink(selectedDocs[0]); setContextMenu(null); }}>
              <Link2 size={14} /> Copy Link
            </button>
          )}
          <hr />
          <button onClick={() => {
            selectedDocs.forEach(d => api.post('/reading', { title: d.title, url: d.path, priority: 1 }));
            setContextMenu(null);
          }}>
            <BookOpen size={14} /> Add to Reading{selectedDocs.length > 1 ? ` (${selectedDocs.length})` : ''}
          </button>
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="text-muted" style={{ textAlign: 'center', padding: 32 }}>
          {search ? 'No matching files' : tab === 'open' ? 'No documents currently open' : 'No recent documents found'}
        </div>
      )}
    </div>
  );
}
