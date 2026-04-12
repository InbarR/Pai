import { chatCompletion } from './copilot';
import { ExtractionResult, ingestExtraction } from './memory-graph';

const EXTRACTION_PROMPT = `You are an entity extraction engine. Given a piece of data from a user's digital life, extract structured entities, relationships, and facts.

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "entities": [
    { "type": "person|project|topic|task|decision|meeting|file", "name": "...", "attributes": {} }
  ],
  "relationships": [
    { "fromType": "...", "fromName": "...", "toType": "...", "toName": "...", "relationType": "works_on|attended|owns|related_to|mentioned_in|decided|assigned_to|discussed|sent_to|received_from|scheduled|created" }
  ],
  "facts": [
    { "entityType": "...", "entityName": "...", "fact": "short factual statement", "confidence": 0.0-1.0 }
  ]
}

Rules:
- Extract REAL entities only — people names, project names, topics, decisions made, tasks assigned
- For people: use their full name if available, email otherwise
- For projects/topics: use the most specific name mentioned
- Facts should be concise, factual statements (e.g., "Presented Q3 results", "Deadline is March 30")
- Confidence: 1.0 for explicit mentions, 0.7 for inferred, 0.5 for weak signals
- Do NOT extract generic words as entities (e.g., "the team", "the meeting")
- Keep it focused — prefer fewer high-quality extractions over many weak ones`;

function buildDataPrompt(source: string, data: any): string {
  switch (source) {
    case 'email':
      return `EMAIL:
From: ${data.fromName} <${data.fromEmail}>
Subject: ${data.subject}
Date: ${data.receivedAt}
Body: ${(data.bodyPreview || data.body || '').substring(0, 1500)}
${data.aiSummary ? `AI Summary: ${data.aiSummary}` : ''}`;

    case 'calendar':
      return `CALENDAR EVENT:
Subject: ${data.subject}
Start: ${data.start}
End: ${data.end}
Organizer: ${data.organizer || 'unknown'}
Location: ${data.location || 'none'}
Attendees: ${(data.attendees || []).join(', ') || 'none'}
${data.body ? `Notes: ${data.body.substring(0, 500)}` : ''}`;

    case 'note':
      return `NOTE/DOCUMENT:
Title: ${data.title}
Tags: ${data.tags || 'none'}
Content: ${(data.content || '').substring(0, 2000)}
Created: ${data.createdAt}`;

    case 'task':
      return `TASK:
Title: ${data.title}
Status: ${data.status === 0 ? 'Todo' : data.status === 1 ? 'In Progress' : 'Done'}
Due: ${data.dueDate || 'none'}
Description: ${(data.description || data.content || '').substring(0, 500)}`;

    case 'chat':
      return `CHAT MESSAGE:
Role: ${data.role}
Content: ${(data.content || '').substring(0, 1500)}
Date: ${data.createdAt}`;

    default:
      return `DATA (${source}):\n${JSON.stringify(data).substring(0, 2000)}`;
  }
}

export async function extractAndIngest(
  source: string,
  data: any,
  sourceId?: string,
  sourceDetail?: string,
  model = 'gpt-4o'
): Promise<ExtractionResult | null> {
  const dataPrompt = buildDataPrompt(source, data);

  try {
    const response = await chatCompletion([
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: dataPrompt },
    ], model, 0.3);

    // Parse JSON — handle potential markdown wrapping
    let json = response.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }

    const extraction: ExtractionResult = JSON.parse(json);

    // Validate structure
    if (!extraction.entities || !Array.isArray(extraction.entities)) {
      console.log('[EntityExtractor] Invalid extraction — no entities array');
      return null;
    }

    // Ingest into graph
    ingestExtraction(extraction, source, sourceId, sourceDetail);
    console.log(`[EntityExtractor] Ingested from ${source}: ${extraction.entities.length} entities, ${extraction.relationships.length} relationships, ${extraction.facts.length} facts`);

    return extraction;
  } catch (err: any) {
    console.log(`[EntityExtractor] Failed for ${source}: ${err.message}`);
    return null;
  }
}

// --- Batch ingestion for existing data ---

export async function ingestEmails(emails: any[]): Promise<number> {
  let count = 0;
  for (const email of emails) {
    const result = await extractAndIngest('email', email, email.id?.toString(), email.subject);
    if (result) count++;
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }
  return count;
}

export async function ingestCalendarEvents(events: any[]): Promise<number> {
  let count = 0;
  for (const event of events) {
    const result = await extractAndIngest('calendar', event, undefined, event.subject);
    if (result) count++;
    await new Promise(r => setTimeout(r, 500));
  }
  return count;
}

export async function ingestNotes(notes: any[]): Promise<number> {
  let count = 0;
  for (const note of notes) {
    const result = await extractAndIngest(
      note.isTask ? 'task' : 'note',
      note,
      note.id?.toString(),
      note.title
    );
    if (result) count++;
    await new Promise(r => setTimeout(r, 500));
  }
  return count;
}

export async function ingestChatMessages(messages: any[]): Promise<number> {
  let count = 0;
  // Only ingest user messages (not assistant responses)
  const userMsgs = messages.filter(m => m.role === 'user');
  for (const msg of userMsgs) {
    const result = await extractAndIngest('chat', msg, msg.id?.toString(), 'Chat message');
    if (result) count++;
    await new Promise(r => setTimeout(r, 500));
  }
  return count;
}
