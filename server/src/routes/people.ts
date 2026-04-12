import { Router } from 'express';
import db from '../db';
import { searchPeople, getMyTeam, getTopPeople, enrichPerson, getDirectReports, getManagerChain } from '../services/people';

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

// Direct reports of a person
router.get('/reports/:nameOrAlias', async (req, res) => {
  try {
    const reports = await getDirectReports(req.params.nameOrAlias);
    res.json(reports);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manager chain (up to 5 levels)
router.get('/chain/:nameOrAlias', async (req, res) => {
  try {
    const chain = await getManagerChain(req.params.nameOrAlias);
    res.json(chain);
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
