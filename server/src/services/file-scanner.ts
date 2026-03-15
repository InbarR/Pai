import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface ScannedDoc {
  title: string;
  path: string;
  type: 'doc' | 'ppt' | 'xls' | 'pdf' | 'other';
  source: 'sharepoint' | 'onedrive' | 'local' | 'teams' | 'other';
  app?: string;
  owner?: string;
}

// ── AD Name Resolution Cache ────────────────────────────────────────
const nameCache = new Map<string, string>();

function extractAliasFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/personal\/([^_/]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch { return null; }
}

function extractTeamFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/(teams|sites)\/([^/]+)/i);
    return match ? match[2] : null;
  } catch { return null; }
}

async function resolveAliases(aliases: string[]): Promise<Map<string, string>> {
  const toResolve = aliases.filter(a => !nameCache.has(a));
  if (toResolve.length === 0) return nameCache;

  const script = `
$aliases = @(${toResolve.map(a => `'${a}'`).join(',')})
$results = @()
foreach ($alias in $aliases) {
  try {
    # Try samaccountname first, then mailnickname, then mail prefix
    $found = $false
    foreach ($filter in @("(samaccountname=$alias)", "(mailnickname=$alias)", "(mail=$alias@*)")) {
      $s = [adsisearcher]$filter
      $r = $s.FindOne()
      if ($r -and $r.Properties['displayname']) {
        $results += [PSCustomObject]@{ Alias = $alias; Name = ($r.Properties['displayname'][0]) }
        $found = $true
        break
      }
    }
  } catch {}
}
if ($results.Count -eq 0) { Write-Output '[]' }
elseif ($results.Count -eq 1) { Write-Output (ConvertTo-Json @($results) -Compress) }
else { Write-Output ($results | ConvertTo-Json -Compress) }
`;

  try {
    const stdout = await runPowerShell(script, false);
    const items = parseJsonOutput(stdout);
    for (const item of items) {
      if (item.Alias && item.Name) {
        nameCache.set(item.Alias.toLowerCase(), item.Name);
      }
    }
  } catch (err) {
    log('AD resolve failed: ' + (err as Error).message);
  }

  return nameCache;
}

function detectSource(filePath: string): ScannedDoc['source'] {
  const lower = filePath.toLowerCase();
  if (lower.includes('sharepoint.com') && !lower.includes('-my.sharepoint.com'))
    return 'sharepoint';
  if (
    lower.includes('onedrive') ||
    lower.includes('1drv.ms') ||
    lower.includes('-my.sharepoint.com')
  )
    return 'onedrive';
  if (lower.includes('teams.microsoft.com')) return 'teams';
  if (lower.startsWith('http')) return 'other';
  return 'local';
}

function detectType(filePath: string): ScannedDoc['type'] {
  const lower = filePath.toLowerCase();
  if (lower.match(/\.docx?(\?|#|$)/)) return 'doc';
  if (lower.match(/\.pptx?m?(\?|#|$)/)) return 'ppt';
  if (lower.match(/\.xlsx?(\?|#|$)/)) return 'xls';
  if (lower.match(/\.pdf(\?|#|$)/)) return 'pdf';
  return 'other';
}

function extractTitle(filePath: string): string {
  if (filePath.startsWith('http')) {
    try {
      const url = new URL(filePath);
      const pathParts = url.pathname.split('/');
      const fileName = pathParts[pathParts.length - 1];
      if (fileName) {
        return decodeURIComponent(fileName)
          .replace(/\.[^.]+$/, '')
          .replace(/%20/g, ' ');
      }
    } catch { /* fall through */ }
  }
  const parts = filePath.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1] || 'Untitled';
  return fileName.replace(/\.[^.]+$/, '');
}

const LOG_FILE = path.join(os.tmpdir(), 'docshelf-debug.log');

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}

async function runPowerShell(script: string, sta = false): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `docshelf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
  try {
    fs.writeFileSync(tmpFile, script, 'utf-8');
    const staFlag = sta ? '-STA ' : '';
    const cmd = `powershell ${staFlag}-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`;
    log(`Running: ${cmd.substring(0, 120)}`);
    const { stdout, stderr } = await execAsync(cmd, {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30000,
    });
    if (stderr && stderr.trim()) {
      log(`STDERR: ${stderr.substring(0, 500)}`);
    }
    log(`STDOUT length: ${stdout.length}, first 200: ${stdout.substring(0, 200)}`);
    return stdout;
  } catch (err: any) {
    log(`EXEC FAILED: ${err?.message || err}`);
    if (err?.stderr) log(`ERR STDERR: ${err.stderr.substring(0, 500)}`);
    if (err?.stdout) {
      log(`ERR STDOUT: ${err.stdout.substring(0, 200)}`);
      return err.stdout;
    }
    throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function parseJsonOutput(stdout: string): any[] {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === '[]') return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // PowerShell ConvertTo-Json can produce broken JSON when values contain
    // unescaped quotes (e.g. smart quotes in filenames like "Loop").
    // Try to fix by replacing unescaped double quotes inside string values.
    try {
      // Replace smart/curly quotes with regular escaped ones
      const fixed = trimmed
        .replace(/\u201C/g, '\\"')
        .replace(/\u201D/g, '\\"')
        .replace(/\u201E/g, '\\"')
        .replace(/\u201F/g, '\\"');
      const parsed = JSON.parse(fixed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Last resort: try to extract individual JSON objects
      log('JSON parse failed even after fix, trying regex extraction');
      const results: any[] = [];
      const regex = /\{[^{}]*"Title"\s*:\s*"[^"]*"[^{}]*\}/g;
      let match;
      while ((match = regex.exec(trimmed)) !== null) {
        try {
          results.push(JSON.parse(match[0]));
        } catch { /* skip malformed object */ }
      }
      return results;
    }
  }
}

// ── SINGLE comprehensive Open Docs scan ─────────────────────────────
// Runs ONE PowerShell process with -STA that does:
//   1. COM automation (gets full URLs from Word/Excel/PowerPoint)
//   2. Window titles (catches what COM misses)
//   3. MRU cross-reference (maps window titles → URLs)

const OPEN_DOCS_SCRIPT = `
$allResults = @()

# ── Step 1: Build MRU lookup table (title → path) ──
$mruLookup = @{}
$apps = @{ 'Word' = 'doc'; 'Excel' = 'xls'; 'PowerPoint' = 'ppt' }
foreach ($app in $apps.Keys) {
  $regPath = "HKCU:\\Software\\Microsoft\\Office\\16.0\\$app\\File MRU"
  if (Test-Path $regPath) {
    $items = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
    foreach ($prop in $items.PSObject.Properties) {
      if ($prop.Name -match '^Item \\d+$') {
        $value = $prop.Value
        $mruPath = $null
        if ($value -match '\\[F00000000\\]\\*(.+)$') { $mruPath = $Matches[1] }
        elseif ($value -match '\\*(.+)$') { $mruPath = $Matches[1] }
        if ($mruPath) {
          # Extract just the filename without extension as key
          $fname = [System.IO.Path]::GetFileNameWithoutExtension($mruPath)
          if ($fname) { $mruLookup[$fname.ToLower()] = $mruPath }
        }
      }
    }
  }
}

# ── Step 2: COM automation (gets full paths) ──
$comTitles = @{}

try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
  foreach ($doc in $word.Documents) {
    try {
      $title = ($doc.Name -replace '\\.[^.]+$', '') -replace '[\u201C\u201D\u201E\u201F]', "'"
      $allResults += [PSCustomObject]@{
        Title = $title
        Path = $doc.FullName
        App = 'Word'
        Type = 'doc'
      }
      $comTitles[$title.ToLower()] = $true
    } catch {}
  }
} catch {}

try {
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  foreach ($wb in $excel.Workbooks) {
    try {
      $title = ($wb.Name -replace '\\.[^.]+$', '')
      $allResults += [PSCustomObject]@{
        Title = $title
        Path = $wb.FullName
        App = 'Excel'
        Type = 'xls'
      }
      $comTitles[$title.ToLower()] = $true
    } catch {}
  }
} catch {}

try {
  $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
  foreach ($pres in $ppt.Presentations) {
    try {
      $title = ($pres.Name -replace '\\.[^.]+$', '')
      $allResults += [PSCustomObject]@{
        Title = $title
        Path = $pres.FullName
        App = 'PowerPoint'
        Type = 'ppt'
      }
      $comTitles[$title.ToLower()] = $true
    } catch {}
  }
} catch {}

# ── Step 3: Window titles for docs COM missed ──
$officeApps = @(
  @{ Process = 'WINWORD';  App = 'Word';       Type = 'doc' },
  @{ Process = 'EXCEL';    App = 'Excel';      Type = 'xls' },
  @{ Process = 'POWERPNT'; App = 'PowerPoint'; Type = 'ppt' }
)

foreach ($oa in $officeApps) {
  $procs = Get-Process -Name $oa.Process -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    $t = $p.MainWindowTitle
    if ($t -and $t -ne '') {
      $clean = $t -replace '\\s*-\\s*(Microsoft\\s+)?(Word|Excel|PowerPoint).*$', ''
      $clean = $clean -replace '\\s*\\[Read-Only\\]', '' -replace '\\s*\\[Compatibility Mode\\]', ''
      $clean = $clean.Trim()
      if ($clean -ne '' -and -not $comTitles.ContainsKey($clean.ToLower())) {
        # Try to find URL from MRU
        $mruPath = ''
        if ($mruLookup.ContainsKey($clean.ToLower())) {
          $mruPath = $mruLookup[$clean.ToLower()]
        }
        $allResults += [PSCustomObject]@{
          Title = $clean
          Path = $mruPath
          App = $oa.App
          Type = $oa.Type
        }
        $comTitles[$clean.ToLower()] = $true
      }
    }
  }
}

# ── Step 4: Browser window titles for online docs ──
$browserProcs = Get-Process -Name msedge, chrome, firefox -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -ne '' }

foreach ($bp in $browserProcs) {
  $t = $bp.MainWindowTitle
  $clean = $t -replace '\\s*-\\s*(Microsoft\\s+Edge|Google\\s+Chrome|Mozilla\\s+Firefox|Work).*$', ''
  $clean = $clean -replace '\\.(docx?|pptx?|xlsx?)\\s.*$', ''
  $clean = $clean.Trim()
  if ($clean -eq '' -or $clean -like 'New Tab*' -or $clean -like 'Settings*') { continue }
  if ($comTitles.ContainsKey($clean.ToLower())) { continue }

  # Check if it looks like a document
  $docHints = @('.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.pdf',
    'Word', 'Excel', 'PowerPoint', 'SharePoint', 'OneDrive')
  $isDoc = $false
  foreach ($h in $docHints) {
    if ($clean -like "*$h*" -or $t -like "*$h*") { $isDoc = $true; break }
  }
  if (-not $isDoc) { continue }

  $type = 'other'
  if ($t -match 'Word' -or $clean -match '\\.(docx?|doc)') { $type = 'doc' }
  elseif ($t -match 'PowerPoint' -or $clean -match '\\.(pptx?|ppt)') { $type = 'ppt' }
  elseif ($t -match 'Excel' -or $clean -match '\\.(xlsx?|xls)') { $type = 'xls' }
  elseif ($clean -match '\\.pdf') { $type = 'pdf' }

  $mruPath = ''
  if ($mruLookup.ContainsKey($clean.ToLower())) { $mruPath = $mruLookup[$clean.ToLower()] }

  $allResults += [PSCustomObject]@{
    Title = $clean
    Path = $mruPath
    App = 'Browser'
    Type = $type
  }
  $comTitles[$clean.ToLower()] = $true
}

# ── Step 5: PDF readers ──
$pdfProcs = Get-Process -Name Acrobat, AcroRd32, FoxitReader, SumatraPDF -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -ne '' }
foreach ($pp in $pdfProcs) {
  $t = $pp.MainWindowTitle
  $clean = $t -replace '\\s*-\\s*(Adobe\\s+)?(Acrobat|Reader|Foxit|SumatraPDF).*$', ''
  $clean = $clean.Trim()
  if ($clean -ne '' -and -not $comTitles.ContainsKey($clean.ToLower())) {
    $allResults += [PSCustomObject]@{
      Title = $clean; Path = ''; App = 'PDF'; Type = 'pdf'
    }
  }
}

# ── Output ──
if ($allResults.Count -eq 0) { Write-Output '[]' }
elseif ($allResults.Count -eq 1) { Write-Output (ConvertTo-Json @($allResults) -Compress) }
else { Write-Output ($allResults | ConvertTo-Json -Compress) }
`;

async function enrichWithNames(docs: ScannedDoc[]): Promise<ScannedDoc[]> {
  // Collect all aliases to resolve
  const aliases = new Set<string>();
  for (const doc of docs) {
    const alias = extractAliasFromUrl(doc.path);
    if (alias) aliases.add(alias);
  }

  if (aliases.size > 0) {
    await resolveAliases([...aliases]);
  }

  // Set owner from AD cache or team name
  return docs.map((doc) => {
    const alias = extractAliasFromUrl(doc.path);
    if (alias && nameCache.has(alias)) {
      return { ...doc, owner: nameCache.get(alias) };
    }
    const team = extractTeamFromUrl(doc.path);
    if (team) {
      return { ...doc, owner: team };
    }
    return doc;
  });
}

export async function scanOpenDocs(): Promise<ScannedDoc[]> {
  try {
    const stdout = await runPowerShell(OPEN_DOCS_SCRIPT, true);
    const items = parseJsonOutput(stdout);

    const docs = items
      .filter((item: any) => item.Title && item.Path && item.Path.startsWith('http'))
      .map((item: any) => ({
        title: item.Title || extractTitle(item.Path || ''),
        path: (item.Path || '').replace(/ /g, '%20'),
        type: (item.Type || detectType(item.Path || '')) as ScannedDoc['type'],
        source: item.Path ? detectSource(item.Path) : 'other',
        app: item.App,
      }));

    return enrichWithNames(docs);
  } catch (err) {
    console.error('scanOpenDocs failed:', err);
    return [];
  }
}

// ── Recent Document Scanner ─────────────────────────────────────────

const RECENT_DOCS_SCRIPT = `
$results = @()

# MRU from registry
$apps = @{ 'Word' = 'doc'; 'Excel' = 'xls'; 'PowerPoint' = 'ppt' }
foreach ($app in $apps.Keys) {
  $regPath = "HKCU:\\Software\\Microsoft\\Office\\16.0\\$app\\File MRU"
  if (Test-Path $regPath) {
    $items = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
    foreach ($prop in $items.PSObject.Properties) {
      if ($prop.Name -match '^Item \\d+$') {
        $value = $prop.Value
        $mruPath = $null
        if ($value -match '\\[F00000000\\]\\*(.+)$') { $mruPath = $Matches[1] }
        elseif ($value -match '\\*(.+)$') { $mruPath = $Matches[1] }
        if ($mruPath) {
          $results += [PSCustomObject]@{ Path = $mruPath; AppType = $apps[$app]; App = $app }
        }
      }
    }
  }
}

# Windows Recent .lnk files
$shell = New-Object -ComObject WScript.Shell
$recentPath = [Environment]::GetFolderPath('Recent')
$lnkFiles = Get-ChildItem $recentPath -Filter "*.lnk" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 100
foreach ($lnk in $lnkFiles) {
  try {
    $shortcut = $shell.CreateShortcut($lnk.FullName)
    $target = $shortcut.TargetPath
    if ($target -match '\\.(docx?|pptx?m?|xlsx?|pdf)$') {
      $results += [PSCustomObject]@{ Path = $target; AppType = ''; App = 'Recent' }
    }
  } catch {}
}
try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null } catch {}

if ($results.Count -eq 0) { Write-Output '[]' }
elseif ($results.Count -eq 1) { Write-Output (ConvertTo-Json @($results) -Compress) }
else { Write-Output ($results | ConvertTo-Json -Compress) }
`;

export async function scanRecentDocs(): Promise<ScannedDoc[]> {
  try {
    const stdout = await runPowerShell(RECENT_DOCS_SCRIPT, true);
    const items = parseJsonOutput(stdout);

    const seen = new Set<string>();
    const results: ScannedDoc[] = [];

    for (const item of items) {
      if (!item.Path) continue;
      const key = item.Path.toLowerCase().replace(/\\/g, '/');
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        title: extractTitle(item.Path),
        path: item.Path.replace(/ /g, '%20'),
        type: (item.AppType || detectType(item.Path)) as ScannedDoc['type'],
        source: detectSource(item.Path),
        app: item.App,
      });
    }

    return enrichWithNames(results);
  } catch (err) {
    console.error('scanRecentDocs failed:', err);
    return [];
  }
}
