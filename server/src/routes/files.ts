import { Router } from 'express';
import { execSync } from 'child_process';
import { scanOpenDocs, scanRecentDocs, ScannedDoc } from '../services/file-scanner';

const router = Router();

let cachedOpen: ScannedDoc[] = [];
let cachedRecent: ScannedDoc[] = [];
let lastScanTime = 0;

router.get('/open', async (req, res) => {
  try {
    // Cache for 10 seconds
    if (Date.now() - lastScanTime > 10_000) {
      cachedOpen = await scanOpenDocs();
      lastScanTime = Date.now();
    }
    res.json(cachedOpen);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recent', async (req, res) => {
  try {
    cachedRecent = await scanRecentDocs();
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

// Open a URL/file in the system default browser/app
router.post('/open', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });
  try {
    let cleanUrl = url.replace(/"/g, '');
    // For SharePoint Office docs, modify URL to force browser viewing
    if (cleanUrl.includes('sharepoint.com')) {
      try {
        const u = new URL(cleanUrl);
        // Only add web=1 for direct file links (not already web-view URLs)
        if (!u.searchParams.has('web') && !cleanUrl.includes('/_layouts/')) {
          u.searchParams.set('web', '1');
          cleanUrl = u.toString();
        }
      } catch { /* keep original URL if parsing fails */ }
    }
    try {
      execSync(`start msedge "${cleanUrl}"`, { windowsHide: true, shell: 'cmd.exe' as any });
    } catch {
      execSync(`start "" "${cleanUrl}"`, { windowsHide: true, shell: 'cmd.exe' as any });
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
