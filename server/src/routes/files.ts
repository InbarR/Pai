import { Router } from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import db from '../db';
import { scanOpenDocs, scanRecentDocs, ScannedDoc } from '../services/file-scanner';
import { getFileConnections } from '../services/file-connections';
import { generateFileViews } from '../services/file-views';

const router = Router();

let cachedOpen: ScannedDoc[] = [];
let cachedRecent: ScannedDoc[] = [];
let lastOpenScan = 0;
let lastRecentScan = 0;

// Auto-scan on startup
setTimeout(async () => {
  try {
    cachedOpen = await scanOpenDocs();
    lastOpenScan = Date.now();
    cachedRecent = await scanRecentDocs();
    lastRecentScan = Date.now();
    console.log(`[Files] Startup scan: ${cachedOpen.length} open, ${cachedRecent.length} recent`);
  } catch {}
}, 3000);

router.get('/open', async (req, res) => {
  try {
    // Cache for 10 seconds
    if (Date.now() - lastOpenScan > 10_000) {
      cachedOpen = await scanOpenDocs();
      lastOpenScan = Date.now();
    }
    res.json(cachedOpen);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recent', async (req, res) => {
  try {
    // Cache for 60 seconds
    if (Date.now() - lastRecentScan > 60_000) {
      cachedRecent = await scanRecentDocs();
      lastRecentScan = Date.now();
    }
    res.json(cachedRecent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    lastScanTime = 0;
    const [open, recent] = await Promise.all([scanOpenDocs(), scanRecentDocs()]);
    cachedOpen = open;
    cachedRecent = recent;
    lastScanTime = Date.now();
    res.json({ open: open.length, recent: recent.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Browse local filesystem
router.get('/browse', (req, res) => {
  const reqPath = (req.query.path as string) || '';

  // Return root drives/shortcuts if no path given
  if (!reqPath) {
    const home = os.homedir();
    const roots = [
      { name: 'Desktop', path: path.join(home, 'Desktop'), isDir: true },
      { name: 'Documents', path: path.join(home, 'Documents'), isDir: true },
      { name: 'Downloads', path: path.join(home, 'Downloads'), isDir: true },
    ];
    // Add C:\ and other drives on Windows
    if (process.platform === 'win32') {
      for (const drive of ['C:\\', 'D:\\', 'E:\\']) {
        try { fs.accessSync(drive); roots.push({ name: drive, path: drive, isDir: true }); } catch {}
      }
    }
    return res.json({ path: '', entries: roots });
  }

  try {
    const entries = fs.readdirSync(reqPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') || e.isDirectory())
      .map(e => {
        const fullPath = path.join(reqPath, e.name);
        const isDir = e.isDirectory();
        let size: number | undefined;
        let modified: string | undefined;
        if (!isDir) {
          try { const s = fs.statSync(fullPath); size = s.size; modified = s.mtime.toISOString(); } catch {}
        }
        return { name: e.name, path: fullPath, isDir, size, modified };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: reqPath, entries });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Open a URL/file in the system default browser/app
router.post('/open', (req, res) => {
  const { url, mode = 'browser' } = req.body; // mode: 'browser' | 'app'
  if (!url) return res.status(400).json({ error: 'No URL' });
  try {
    let cleanUrl = url.replace(/"/g, '');

    if (mode === 'browser') {
      // Force browser viewing for SharePoint/OneDrive docs
      if (/sharepoint[^/]*\.com/i.test(cleanUrl)) {
        try {
          const u = new URL(cleanUrl);
          if (!u.searchParams.has('web') && !cleanUrl.includes('/_layouts/')) {
            u.searchParams.set('web', '1');
            cleanUrl = u.toString();
          }
        } catch {}
      }
      try {
        execSync(`start msedge "${cleanUrl}"`, { windowsHide: true, shell: 'cmd.exe' as any });
      } catch {
        execSync(`start "" "${cleanUrl}"`, { windowsHide: true, shell: 'cmd.exe' as any });
      }
    } else {
      // Open in native app (Word, Excel, etc.) — use ms-word: protocol or direct URL without web=1
      const protoMap: Record<string, string> = {
        doc: 'ms-word:ofe|u|', ppt: 'ms-powerpoint:ofe|u|', xls: 'ms-excel:ofe|u|',
        visio: 'ms-visio:ofe|u|',
      };
      const ext = cleanUrl.match(/\.(docx?|pptx?|xlsx?|vsdx?)(\?|#|$)/i);
      const type = ext ? (ext[1].startsWith('doc') ? 'doc' : ext[1].startsWith('ppt') ? 'ppt' : ext[1].startsWith('xls') ? 'xls' : ext[1].startsWith('vsd') ? 'visio' : '') : '';
      const proto = protoMap[type];
      if (proto) {
        execSync(`start "" "${proto}${cleanUrl}"`, { windowsHide: true, shell: 'cmd.exe' as any });
      } else {
        execSync(`start "" "${cleanUrl}"`, { windowsHide: true, shell: 'cmd.exe' as any });
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamic context-aware file views
router.get('/views', async (req, res) => {
  res.json(await generateFileViews());
});

// Get cross-entity connections for a file
router.get('/connections', (req, res) => {
  const name = req.query.name as string;
  const filePath = req.query.path as string;
  if (!name) return res.status(400).json({ error: 'name query param required' });
  res.json(getFileConnections(name, filePath));
});

// Pinned files
router.get('/pinned', (req, res) => {
  const row = db.prepare("SELECT value FROM AppSettings WHERE key = 'pinned_files'").get() as any;
  res.json(row ? JSON.parse(row.value) : []);
});

router.post('/pin', (req, res) => {
  const { title, path, type, source } = req.body;
  if (!title || !path) return res.status(400).json({ error: 'title and path required' });
  const row = db.prepare("SELECT value FROM AppSettings WHERE key = 'pinned_files'").get() as any;
  const pinned: any[] = row ? JSON.parse(row.value) : [];
  if (!pinned.find((p: any) => p.path === path)) {
    pinned.push({ title, path, type, source });
    db.prepare("INSERT OR REPLACE INTO AppSettings (key, value) VALUES ('pinned_files', ?)").run(JSON.stringify(pinned));
  }
  res.json(pinned);
});

router.post('/unpin', (req, res) => {
  const { path } = req.body;
  const row = db.prepare("SELECT value FROM AppSettings WHERE key = 'pinned_files'").get() as any;
  let pinned: any[] = row ? JSON.parse(row.value) : [];
  pinned = pinned.filter((p: any) => p.path !== path);
  db.prepare("INSERT OR REPLACE INTO AppSettings (key, value) VALUES ('pinned_files', ?)").run(JSON.stringify(pinned));
  res.json(pinned);
});

export default router;
