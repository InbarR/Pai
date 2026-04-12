/**
 * Azure DevOps (ADO) integration service.
 * Uses the user's Azure AD token via `az cli` — no PAT needed.
 * The token is fetched on demand and cached until expiry.
 */

import { execSync } from 'child_process';

const ADO_API_VERSION = '7.1';
const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'; // ADO resource ID

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAdoToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  try {
    const token = execSync(
      `az account get-access-token --resource ${ADO_RESOURCE} --query accessToken -o tsv`,
      { encoding: 'utf-8', timeout: 10000, windowsHide: true }
    ).trim();

    // Token is valid for ~1 hour, cache for 50 minutes
    cachedToken = { token, expiresAt: Date.now() + 50 * 60000 };
    return token;
  } catch (err: any) {
    throw new Error('Failed to get ADO token. Make sure you are logged in with `az login`.');
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json-patch+json',
    'Accept': 'application/json',
  };
}

// --- Parse ADO URL ---
export function parseAdoUrl(url: string): { org: string; project: string; id: number } | null {
  const match = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_workitems\/edit\/(\d+)/);
  if (match) return { org: match[1], project: match[2], id: parseInt(match[3]) };
  const match2 = url.match(/(\w+)\.visualstudio\.com\/([^/]+)\/_workitems\/edit\/(\d+)/);
  if (match2) return { org: match2[1], project: match2[2], id: parseInt(match2[3]) };
  return null;
}

function apiUrl(org: string, project: string, path: string): string {
  const base = `https://dev.azure.com/${org}`;
  return project ? `${base}/${project}/_apis/${path}` : `${base}/_apis/${path}`;
}

// --- Get work item ---
export async function getWorkItem(id: number, org: string, project: string): Promise<any> {
  const token = await getAdoToken();
  const url = apiUrl(org, project, `wit/workitems/${id}?$expand=all&api-version=${ADO_API_VERSION}`);

  const res = await fetch(url, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`ADO API error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return {
    id: data.id,
    title: data.fields?.['System.Title'] || '',
    state: data.fields?.['System.State'] || '',
    assignedTo: data.fields?.['System.AssignedTo']?.displayName || '',
    assignedToEmail: data.fields?.['System.AssignedTo']?.uniqueName || '',
    type: data.fields?.['System.WorkItemType'] || '',
    areaPath: data.fields?.['System.AreaPath'] || '',
    iterationPath: data.fields?.['System.IterationPath'] || '',
    priority: data.fields?.['Microsoft.VSTS.Common.Priority'] || 0,
    severity: data.fields?.['Microsoft.VSTS.Common.Severity'] || '',
    createdBy: data.fields?.['System.CreatedBy']?.displayName || '',
    createdDate: data.fields?.['System.CreatedDate'] || '',
    changedDate: data.fields?.['System.ChangedDate'] || '',
    description: (data.fields?.['System.Description'] || '').replace(/<[^>]+>/g, '').substring(0, 500),
    tags: data.fields?.['System.Tags'] || '',
    url: data._links?.html?.href || `https://dev.azure.com/${org}/${project}/_workitems/edit/${id}`,
  };
}

// --- Update work item fields ---
export async function updateWorkItem(id: number, org: string, project: string, fields: Record<string, any>): Promise<any> {
  const token = await getAdoToken();
  const url = apiUrl(org, project, `wit/workitems/${id}?api-version=${ADO_API_VERSION}`);

  const patchDoc = Object.entries(fields).map(([path, value]) => ({
    op: 'replace',
    path: `/fields/${path}`,
    value,
  }));

  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patchDoc),
  });
  if (!res.ok) throw new Error(`ADO API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    id: data.id,
    title: data.fields?.['System.Title'] || '',
    state: data.fields?.['System.State'] || '',
    assignedTo: data.fields?.['System.AssignedTo']?.displayName || '',
  };
}

// --- Assign work item ---
export async function assignWorkItem(id: number, org: string, project: string, assignee: string): Promise<any> {
  return updateWorkItem(id, org, project, { 'System.AssignedTo': assignee });
}

// --- Change work item state ---
export async function changeWorkItemState(id: number, org: string, project: string, state: string): Promise<any> {
  return updateWorkItem(id, org, project, { 'System.State': state });
}

// --- Add comment ---
export async function addWorkItemComment(id: number, org: string, project: string, comment: string): Promise<any> {
  const token = await getAdoToken();
  const url = apiUrl(org, project, `wit/workitems/${id}/comments?api-version=${ADO_API_VERSION}-preview.4`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: comment }),
  });
  if (!res.ok) throw new Error(`ADO API error ${res.status}: ${await res.text()}`);
  return { success: true, message: 'Comment added.' };
}

// --- Query work items (WIQL) ---
export async function queryWorkItems(wiql: string, org: string, project: string): Promise<any[]> {
  const token = await getAdoToken();
  const url = apiUrl(org, project, `wit/wiql?api-version=${ADO_API_VERSION}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: wiql }),
  });
  if (!res.ok) throw new Error(`ADO API error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  if (!data.workItems || data.workItems.length === 0) return [];

  const ids = data.workItems.slice(0, 20).map((wi: any) => wi.id);
  const detailUrl = apiUrl(org, project, `wit/workitems?ids=${ids.join(',')}&$expand=all&api-version=${ADO_API_VERSION}`);
  const detailRes = await fetch(detailUrl, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
  });
  if (!detailRes.ok) return [];
  const details = await detailRes.json();

  return (details.value || []).map((wi: any) => ({
    id: wi.id,
    title: wi.fields?.['System.Title'] || '',
    state: wi.fields?.['System.State'] || '',
    assignedTo: wi.fields?.['System.AssignedTo']?.displayName || '',
    type: wi.fields?.['System.WorkItemType'] || '',
    priority: wi.fields?.['Microsoft.VSTS.Common.Priority'] || 0,
    tags: wi.fields?.['System.Tags'] || '',
  }));
}

// --- Search work items ---
export async function searchWorkItems(query: string, org: string, project: string): Promise<any[]> {
  const wiql = `SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo]
    FROM WorkItems
    WHERE [System.Title] CONTAINS '${query.replace(/'/g, "''")}'
    ORDER BY [System.ChangedDate] DESC`;
  return queryWorkItems(wiql, org, project);
}

// --- Get my work items ---
export async function getMyWorkItems(org: string, project: string): Promise<any[]> {
  const wiql = `SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo]
    FROM WorkItems
    WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed' AND [System.State] <> 'Removed'
    ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;
  return queryWorkItems(wiql, org, project);
}

// --- Check if az cli is available ---
export function isAdoAvailable(): boolean {
  try {
    execSync('az --version', { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    return true;
  } catch { return false; }
}
