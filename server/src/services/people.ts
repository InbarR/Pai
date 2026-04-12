import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

function runPowerShell(script: string): string {
  const tmpFile = path.join(os.tmpdir(), `pai-ps-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tmpFile, script, 'utf-8');
    return execSync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { encoding: 'utf-8', timeout: 15_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
    );
  } catch (err: any) {
    return err.stdout || '[]';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { }
  }
}

function parseJson(stdout: string): any[] {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === '[]') return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

export interface OrgPerson {
  name: string;
  email: string;
  title: string;
  department: string;
  office: string;
  phone: string;
  manager: string;
  alias: string;
}

// Search AD for people by name, alias, or email
export async function searchPeople(query: string): Promise<OrgPerson[]> {
  const q = query.replace(/'/g, "''");
  const script = `
$results = @()
$searcher = [adsisearcher]"(&(objectClass=user)(objectCategory=person)(|(displayname=${q}*)(samaccountname=${q}*)(mail=${q}@*)(displayname=* ${q}*)))"
$searcher.PropertiesToLoad.AddRange(@('displayname','mail','title','department','physicaldeliveryofficename','telephonenumber','samaccountname','manager'))
$searcher.SizeLimit = 15
$searcher.ServerTimeLimit = [TimeSpan]::FromSeconds(5)
$searcher.ClientTimeout = [TimeSpan]::FromSeconds(8)
$found = $searcher.FindAll()
foreach ($r in $found) {
  $p = $r.Properties
  $mgr = ''
  if ($p['manager'] -and $p['manager'].Count -gt 0) {
    $mgrDn = $p['manager'][0]
    if ($mgrDn -match 'CN=([^,]+)') { $mgr = $Matches[1] }
  }
  $results += [PSCustomObject]@{
    Name = if ($p['displayname']) { $p['displayname'][0] } else { '' }
    Email = if ($p['mail']) { $p['mail'][0] } else { '' }
    Title = if ($p['title']) { $p['title'][0] } else { '' }
    Department = if ($p['department']) { $p['department'][0] } else { '' }
    Office = if ($p['physicaldeliveryofficename']) { $p['physicaldeliveryofficename'][0] } else { '' }
    Phone = if ($p['telephonenumber']) { $p['telephonenumber'][0] } else { '' }
    Alias = if ($p['samaccountname']) { $p['samaccountname'][0] } else { '' }
    Manager = $mgr
  }
}
if ($results.Count -eq 0) { Write-Output '[]' }
elseif ($results.Count -eq 1) { Write-Output (ConvertTo-Json @($results) -Compress) }
else { Write-Output ($results | ConvertTo-Json -Compress) }
`;
  const stdout = runPowerShell(script);
  return parseJson(stdout).map(mapPerson);
}

// Get current user's direct reports (My Team)
export async function getMyTeam(): Promise<OrgPerson[]> {
  const script = `
$me = [adsisearcher]"(&(objectClass=user)(samaccountname=$env:USERNAME))"
$meResult = $me.FindOne()
if (-not $meResult) { Write-Output '[]'; exit }
$myDn = $meResult.Properties['distinguishedname'][0]

$results = @()
$searcher = [adsisearcher]"(&(objectClass=user)(objectCategory=person)(manager=$myDn))"
$searcher.PropertiesToLoad.AddRange(@('displayname','mail','title','department','physicaldeliveryofficename','telephonenumber','samaccountname','manager'))
$found = $searcher.FindAll()
foreach ($r in $found) {
  $p = $r.Properties
  $results += [PSCustomObject]@{
    Name = if ($p['displayname']) { $p['displayname'][0] } else { '' }
    Email = if ($p['mail']) { $p['mail'][0] } else { '' }
    Title = if ($p['title']) { $p['title'][0] } else { '' }
    Department = if ($p['department']) { $p['department'][0] } else { '' }
    Office = if ($p['physicaldeliveryofficename']) { $p['physicaldeliveryofficename'][0] } else { '' }
    Phone = if ($p['telephonenumber']) { $p['telephonenumber'][0] } else { '' }
    Alias = if ($p['samaccountname']) { $p['samaccountname'][0] } else { '' }
    Manager = ''
  }
}
if ($results.Count -eq 0) { Write-Output '[]' }
elseif ($results.Count -eq 1) { Write-Output (ConvertTo-Json @($results) -Compress) }
else { Write-Output ($results | ConvertTo-Json -Compress) }
`;
  const stdout = runPowerShell(script);
  return parseJson(stdout).map(mapPerson);
}

// Get frequent contacts (instant — DB only, no AD)
export function getTopPeople(db: any): (OrgPerson & { emailCount: number; lastContact: string })[] {
  const contacts: any[] = db.prepare(`
    SELECT fromName as name, fromEmail as email,
           COUNT(*) as emailCount, MAX(receivedAt) as lastContact
    FROM ImportantEmails WHERE fromName != '' AND fromName != 'Unknown'
    GROUP BY fromName ORDER BY emailCount DESC LIMIT 30
  `).all();

  return contacts.map(c => ({
    name: c.name, email: c.email, title: '', department: '', office: '', phone: '', manager: '',
    alias: c.email.split('@')[0],
    emailCount: c.emailCount, lastContact: c.lastContact,
  }));
}

// Enrich a single person with AD data (called on-demand when clicking)
export async function enrichPerson(nameOrAlias: string): Promise<OrgPerson | null> {
  try {
    const results = await searchPeople(nameOrAlias);
    return results.length > 0 ? results[0] : null;
  } catch { return null; }
}

function mapPerson(p: any): OrgPerson {
  return {
    name: p.Name || '',
    email: p.Email || '',
    title: p.Title || '',
    department: p.Department || '',
    office: p.Office || '',
    phone: p.Phone || '',
    manager: p.Manager || '',
    alias: p.Alias || '',
  };
}

// Get direct reports of a specific person
export async function getDirectReports(nameOrAlias: string): Promise<OrgPerson[]> {
  const q = nameOrAlias.replace(/'/g, "''");
  const script = `
$target = [adsisearcher]"(&(objectClass=user)(|(displayname=*${q}*)(samaccountname=${q})))"
$targetResult = $target.FindOne()
if (-not $targetResult) { Write-Output '[]'; exit }
$targetDn = $targetResult.Properties['distinguishedname'][0]

$results = @()
$searcher = [adsisearcher]"(&(objectClass=user)(objectCategory=person)(manager=$targetDn))"
$searcher.PropertiesToLoad.AddRange(@('displayname','mail','title','department','physicaldeliveryofficename','telephonenumber','samaccountname','manager'))
$searcher.SizeLimit = 50
$found = $searcher.FindAll()
foreach ($r in $found) {
  $p = $r.Properties
  $results += [PSCustomObject]@{
    Name = if ($p['displayname']) { $p['displayname'][0] } else { '' }
    Email = if ($p['mail']) { $p['mail'][0] } else { '' }
    Title = if ($p['title']) { $p['title'][0] } else { '' }
    Department = if ($p['department']) { $p['department'][0] } else { '' }
    Office = if ($p['physicaldeliveryofficename']) { $p['physicaldeliveryofficename'][0] } else { '' }
    Phone = if ($p['telephonenumber']) { $p['telephonenumber'][0] } else { '' }
    Alias = if ($p['samaccountname']) { $p['samaccountname'][0] } else { '' }
    Manager = ''
  }
}
if ($results.Count -eq 0) { Write-Output '[]' }
elseif ($results.Count -eq 1) { Write-Output (ConvertTo-Json @($results) -Compress) }
else { Write-Output ($results | ConvertTo-Json -Compress) }
`;
  return parseJson(runPowerShell(script)).map(mapPerson);
}

// Get manager chain (up to 5 levels)
export async function getManagerChain(nameOrAlias: string): Promise<OrgPerson[]> {
  const q = nameOrAlias.replace(/'/g, "''");
  const script = `
$results = @()
$filter = "(&(objectClass=user)(objectCategory=person)(|(displayname=*${q}*)(samaccountname=${q})(mail=${q}@*)))"
$s = [adsisearcher]$filter
$s.PropertiesToLoad.AddRange(@('displayname','mail','title','department','physicaldeliveryofficename','telephonenumber','samaccountname','manager','distinguishedname'))
$r = $s.FindOne()
if (-not $r) { Write-Output '[]'; exit }

for ($i = 0; $i -lt 5; $i++) {
  $mgrDn = $r.Properties['manager']
  if (-not $mgrDn -or $mgrDn.Count -eq 0) { break }
  $dn = $mgrDn[0]
  try {
    $escapedDn = [System.Security.Principal.SecurityIdentifier]::new(0) # dummy
  } catch {}
  # Use LDAP path directly to avoid filter escaping issues with parens in DN
  $de = [adsi]"LDAP://$dn"
  if (-not $de.Path) { break }
  # Wrap in a search from the entry
  $ms = New-Object DirectoryServices.DirectorySearcher($de)
  $ms.SearchScope = 'Base'
  $ms.Filter = '(objectClass=user)'
  $ms.PropertiesToLoad.AddRange(@('displayname','mail','title','department','physicaldeliveryofficename','telephonenumber','samaccountname','manager'))
  $r = $ms.FindOne()
  if (-not $r) { break }
  $p = $r.Properties
  $results += [PSCustomObject]@{
    Name = if ($p['displayname']) { $p['displayname'][0] } else { '' }
    Email = if ($p['mail']) { $p['mail'][0] } else { '' }
    Title = if ($p['title']) { $p['title'][0] } else { '' }
    Department = if ($p['department']) { $p['department'][0] } else { '' }
    Office = if ($p['physicaldeliveryofficename']) { $p['physicaldeliveryofficename'][0] } else { '' }
    Phone = if ($p['telephonenumber']) { $p['telephonenumber'][0] } else { '' }
    Alias = if ($p['samaccountname']) { $p['samaccountname'][0] } else { '' }
    Manager = ''
  }
}
if ($results.Count -eq 0) { Write-Output '[]' }
elseif ($results.Count -eq 1) { Write-Output (ConvertTo-Json @($results) -Compress) }
else { Write-Output ($results | ConvertTo-Json -Compress) }
`;
  return parseJson(runPowerShell(script)).map(mapPerson);
}
