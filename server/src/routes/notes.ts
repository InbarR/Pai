import { Router } from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import db from '../db';

const router = Router();

// --- OneNote COM import via PowerShell ---

function runPS(script: string, timeout = 30_000): string {
  const tmp = path.join(os.tmpdir(), `pai-on-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tmp, script, 'utf-8');
    return execSync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmp}"`,
      { encoding: 'utf-8', timeout, windowsHide: true, maxBuffer: 5 * 1024 * 1024 }
    );
  } catch (err: any) {
    return err.stdout || '[]';
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// List OneNote notebooks and sections
router.get('/onenote/notebooks', (req, res) => {
  try {
    const script = `
$onenote = New-Object -ComObject OneNote.Application
[xml]$hierarchy = $null
$onenote.GetHierarchy("", [Microsoft.Office.Interop.OneNote.HierarchyScope]::hsSections, [ref]$hierarchy)
$ns = @{one='http://schemas.microsoft.com/office/onenote/2013/onenote'}
$results = @()
foreach ($nb in (Select-Xml -Xml $hierarchy -XPath '//one:Notebook' -Namespace $ns)) {
  $nbNode = $nb.Node
  $sections = @()
  foreach ($sec in $nbNode.SelectNodes('one:Section', (New-Object Xml.XmlNamespaceManager($hierarchy.NameTable)).AddNamespace('one','http://schemas.microsoft.com/office/onenote/2013/onenote') | Out-Null; $nbNode.SelectNodes('one:Section', $nbNode.CreateNavigator().NameTable))) {
    # fallback: iterate children
  }
  foreach ($child in $nbNode.ChildNodes) {
    if ($child.LocalName -eq 'Section') {
      $sections += [PSCustomObject]@{ id = $child.GetAttribute('ID'); name = $child.GetAttribute('name') }
    }
  }
  $results += [PSCustomObject]@{
    id = $nbNode.GetAttribute('ID')
    name = $nbNode.GetAttribute('name')
    sections = $sections
  }
}
Write-Output ($results | ConvertTo-Json -Depth 3 -Compress)
`;
    const stdout = runPS(script);
    const parsed = JSON.parse(stdout.trim() || '[]');
    res.json(Array.isArray(parsed) ? parsed : [parsed]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List pages in a OneNote section
router.get('/onenote/pages/:sectionId', (req, res) => {
  try {
    const sectionId = req.params.sectionId.replace(/'/g, "''");
    const script = `
$onenote = New-Object -ComObject OneNote.Application
[xml]$hierarchy = $null
$onenote.GetHierarchy('${sectionId}', [Microsoft.Office.Interop.OneNote.HierarchyScope]::hsPages, [ref]$hierarchy)
$results = @()
foreach ($node in $hierarchy.SelectNodes('//*[local-name()="Page"]')) {
  $results += [PSCustomObject]@{
    id = $node.GetAttribute('ID')
    name = $node.GetAttribute('name')
    lastModified = $node.GetAttribute('lastModifiedTime')
  }
}
if ($results.Count -eq 0) { Write-Output '[]' }
elseif ($results.Count -eq 1) { Write-Output (ConvertTo-Json @($results) -Compress) }
else { Write-Output ($results | ConvertTo-Json -Compress) }
`;
    const stdout = runPS(script);
    res.json(JSON.parse(stdout.trim() || '[]'));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get a OneNote page content as HTML
router.get('/onenote/page/:pageId', (req, res) => {
  try {
    const pageId = req.params.pageId.replace(/'/g, "''");
    const script = `
$onenote = New-Object -ComObject OneNote.Application
$xml = $null
$onenote.GetPageContent('${pageId}', [ref]$xml)
[xml]$doc = $xml
$ns = 'http://schemas.microsoft.com/office/onenote/2013/onenote'
$title = $doc.DocumentElement.SelectSingleNode('//*[local-name()="Title"]//*[local-name()="T"]')
$body = @()
foreach ($oe in $doc.DocumentElement.SelectNodes('//*[local-name()="OE"]')) {
  foreach ($t in $oe.SelectNodes('*[local-name()="T"]')) {
    $body += $t.InnerText
  }
}
$result = [PSCustomObject]@{
  title = if ($title) { $title.InnerText } else { 'Untitled' }
  html = ($body -join '<br/>')
}
Write-Output ($result | ConvertTo-Json -Compress)
`;
    const stdout = runPS(script);
    res.json(JSON.parse(stdout.trim() || '{}'));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import a OneNote page into Pai notes
router.post('/onenote/import', (req, res) => {
  try {
    const { pageId, notebookId = 1 } = req.body;
    const pageScript = `
$onenote = New-Object -ComObject OneNote.Application
$xml = $null
$onenote.GetPageContent('${(pageId || '').replace(/'/g, "''")}', [ref]$xml)
[xml]$doc = $xml
$title = $doc.DocumentElement.SelectSingleNode('//*[local-name()="Title"]//*[local-name()="T"]')
$body = @()
foreach ($oe in $doc.DocumentElement.SelectNodes('//*[local-name()="OE"]')) {
  foreach ($t in $oe.SelectNodes('*[local-name()="T"]')) {
    $body += $t.InnerText
  }
}
$result = [PSCustomObject]@{
  title = if ($title) { $title.InnerText } else { 'Untitled' }
  html = ($body -join '<br/>')
}
Write-Output ($result | ConvertTo-Json -Compress)
`;
    const stdout = runPS(pageScript);
    const page = JSON.parse(stdout.trim() || '{}');
    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO Notes (title, content, notebookId, isTask, sourceType, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?, ?)'
    ).run(page.title || 'Untitled', page.html || '', notebookId, 'onenote', now, now);
    res.json({ success: true, id: result.lastInsertRowid, title: page.title });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Notebooks ---
router.get('/notebooks', (req, res) => {
  const notebooks = db.prepare('SELECT * FROM Notebooks ORDER BY sortOrder, name').all();
  // Add note count for each
  const counts = db.prepare('SELECT notebookId, COUNT(*) as count FROM Notes WHERE NOT (isTask = 1 AND taskStatus = 2) GROUP BY notebookId').all() as any[];
  const countMap: Record<number, number> = {};
  for (const c of counts) countMap[c.notebookId] = c.count;
  res.json(notebooks.map((nb: any) => ({ ...nb, noteCount: countMap[nb.id] || 0 })));
});

router.post('/notebooks', (req, res) => {
  const { name = 'New Notebook', icon = '' } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare('INSERT INTO Notebooks (name, icon, createdAt) VALUES (?, ?, ?)').run(name, icon, now);
  res.status(201).json(db.prepare('SELECT * FROM Notebooks WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/notebooks/:id', (req, res) => {
  const { name, icon } = req.body;
  db.prepare('UPDATE Notebooks SET name = ?, icon = ? WHERE id = ?').run(name, icon || '', req.params.id);
  res.json(db.prepare('SELECT * FROM Notebooks WHERE id = ?').get(req.params.id));
});

router.delete('/notebooks/:id', (req, res) => {
  // Move notes to General (id=1) before deleting
  db.prepare('UPDATE Notes SET notebookId = 1 WHERE notebookId = ?').run(req.params.id);
  db.prepare('DELETE FROM Notebooks WHERE id = ? AND id != 1').run(req.params.id);
  res.json({ ok: true });
});

// --- Notes ---
router.get('/', (req, res) => {
  const notebookId = req.query.notebookId;
  const sql = notebookId
    ? 'SELECT * FROM Notes WHERE notebookId = ? ORDER BY isPinned DESC, updatedAt DESC'
    : 'SELECT * FROM Notes ORDER BY isPinned DESC, updatedAt DESC';
  const notes = notebookId ? db.prepare(sql).all(notebookId) : db.prepare(sql).all();
  res.json(notes);
});

router.get('/search', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const notes = db.prepare(
    'SELECT * FROM Notes WHERE title LIKE ? OR content LIKE ? ORDER BY isPinned DESC, updatedAt DESC'
  ).all(q, q);
  res.json(notes);
});

router.post('/', (req, res) => {
  const { title = 'Untitled', content = '', tags = '', notebookId = 1, isTask = false, dueDate = null, sourceType = 'manual' } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO Notes (title, content, tags, notebookId, isTask, dueDate, sourceType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(title, content, tags, notebookId, isTask ? 1 : 0, dueDate, sourceType, now, now);
  res.status(201).json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { title, content, tags, notebookId, isPinned, isTask, taskStatus, dueDate } = req.body;
  const now = new Date().toISOString();

  const existing: any = db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    `UPDATE Notes SET title = ?, content = ?, tags = ?, notebookId = ?, isPinned = ?,
     isTask = ?, taskStatus = ?, dueDate = ?, updatedAt = ? WHERE id = ?`
  ).run(
    title ?? existing.title,
    content ?? existing.content,
    tags ?? existing.tags,
    notebookId ?? existing.notebookId,
    isPinned ?? existing.isPinned,
    isTask ?? existing.isTask,
    taskStatus ?? existing.taskStatus,
    dueDate !== undefined ? dueDate : existing.dueDate,
    now,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

// Cycle task status
router.post('/:id/cycle-status', (req, res) => {
  const note: any = db.prepare('SELECT taskStatus FROM Notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const next = (note.taskStatus + 1) % 3;
  const now = new Date().toISOString();
  db.prepare('UPDATE Notes SET taskStatus = ?, updatedAt = ? WHERE id = ?').run(next, now, req.params.id);
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

// Toggle task mode
router.post('/:id/toggle-task', (req, res) => {
  const note: any = db.prepare('SELECT isTask FROM Notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE Notes SET isTask = ? WHERE id = ?').run(note.isTask ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

router.post('/:id/pin', (req, res) => {
  const note: any = db.prepare('SELECT isPinned FROM Notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE Notes SET isPinned = ? WHERE id = ?').run(note.isPinned ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM Notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
