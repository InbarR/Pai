import { Router } from 'express';
import db from '../db';
import { searchPeople, getMyTeam, getTopPeople, enrichPerson } from '../services/people';

const router = Router();

// Top people (frequent contacts enriched with AD)
router.get('/top', (req, res) => {
  try {
    const people = getTopPeople(db);
    res.json(people);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Enrich a single person with AD data (on-demand)
router.get('/enrich/:alias', async (req, res) => {
  try {
    const person = await enrichPerson(req.params.alias);
    res.json(person || { error: 'Not found' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// My team (direct reports)
router.get('/team', async (req, res) => {
  try {
    const team = await getMyTeam();
    res.json(team);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Search org
router.get('/search', async (req, res) => {
  const q = (req.query.q as string) || '';
  if (q.length < 2) return res.json([]);
  try {
    const results = await searchPeople(q);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get emails from a specific person
router.get('/:name/emails', (req, res) => {
  const emails = db.prepare(
    'SELECT * FROM ImportantEmails WHERE fromName = ? ORDER BY receivedAt DESC LIMIT 20'
  ).all(req.params.name);
  res.json(emails);
});

export default router;
