import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as notesDb from '../db/notes';
import { ApiError, readJson, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const notFound = () => new ApiError(404, 'Not bulunamadı.');

const notes = new Hono<HonoEnv>();

// Static sub-paths are registered before /api/notes/:id on purpose.

// GET /api/notes?q=&tag=&pinned=&limit=&offset=&sort=updated|created|title
//   -> { notes: [{ id, title, excerpt, tags, pinned, updatedAt, createdAt, backlinkCount }], total }
notes.get('/api/notes', requiresLogin, (c) => {
  try {
    const q = (k: string) => c.req.query(k);
    return c.json(notesDb.listNotes(c.get('db'), c.get('user').id, {
      q: q('q'), tag: q('tag'), pinned: q('pinned'), limit: q('limit'), offset: q('offset'), sort: q('sort'),
    }));
  } catch (err) {
    return sendError(c, err, 'Notes list');
  }
});

// GET /api/notes/tags -> { tags: [{ tag, count }] }
notes.get('/api/notes/tags', requiresLogin, (c) => {
  try {
    return c.json({ tags: notesDb.listTags(c.get('db'), c.get('user').id) });
  } catch (err) {
    return sendError(c, err, 'Notes tags');
  }
});

// GET /api/notes/export -> [{ name, content }] (Markdown files with YAML front matter)
notes.get('/api/notes/export', requiresLogin, (c) => {
  try {
    return c.json(notesDb.exportNotes(c.get('db'), c.get('user').id));
  } catch (err) {
    return sendError(c, err, 'Notes export');
  }
});

// POST /api/notes/import { files: [{ name, content }] } -> { imported, notes: [{ id, title, name }], skipped: [{ name, reason }] }
notes.post('/api/notes/import', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(notesDb.importNotes(c.get('db'), c.get('user').id, body));
  } catch (err) {
    return sendError(c, err, 'Notes import');
  }
});

// POST /api/notes/daily { date?: YYYY-MM-DD } -> note (201 when created, 200 when it already existed)
notes.post('/api/notes/daily', requiresLogin, async (c) => {
  try {
    let body: Record<string, unknown> = {};
    const raw = await c.req.text();
    if (raw.trim()) {
      try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'Geçersiz JSON gövdesi.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'İstek gövdesi bir JSON nesnesi olmalı.');
    }
    const { note, created } = notesDb.getOrCreateDaily(c.get('db'), c.get('user').id, body.date);
    return c.json(note, created ? 201 : 200);
  } catch (err) {
    return sendError(c, err, 'Notes daily');
  }
});

// POST /api/notes { title?, body?, pinned? } -> note (201)
notes.post('/api/notes', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(notesDb.createNote(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Notes create');
  }
});

// GET /api/notes/:id -> { note, backlinks: [{ type, id, label, missing }], outgoing: [{ type, id, label, missing, target, key }] }
notes.get('/api/notes/:id', requiresLogin, (c) => {
  try {
    const detail = notesDb.getNoteDetail(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!detail) throw notFound();
    return c.json(detail);
  } catch (err) {
    return sendError(c, err, 'Notes get');
  }
});

// PATCH /api/notes/:id { title?, body?, pinned? } -> same shape as GET /api/notes/:id
notes.patch('/api/notes/:id', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(notesDb.updateNote(c.get('db'), c.get('user').id, c.req.param('id'), body));
  } catch (err) {
    return sendError(c, err, 'Notes update');
  }
});

// DELETE /api/notes/:id (also removes its links)
notes.delete('/api/notes/:id', requiresLogin, (c) => {
  try {
    if (!notesDb.deleteNote(c.get('db'), c.get('user').id, c.req.param('id'))) throw notFound();
    return c.json({ ok: true });
  } catch (err) {
    return sendError(c, err, 'Notes delete');
  }
});

export default notes;
