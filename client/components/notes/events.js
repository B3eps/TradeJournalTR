/*
 * Window events used by the Notes page.
 *
 *   'app:navigate'  detail { page: 'notes', itemId, itemType: 'note' }   (shared bus, utils/navigation.js)
 *                   -> NotesPage opens that note. itemId may also be a YYYY-MM-DD date:
 *                      the daily note of that date is opened (created if needed).
 *   'app:new-note'  detail { title?, body? } (optional)
 *                   -> NotesPage creates a new note and opens it.
 *
 * From anywhere (e.g. the command palette "Yeni not" action) call
 *   require('../notes/events').requestNewNote()
 * which switches to the Notes page and creates the note even if the page was
 * not mounted yet (a pending flag is consumed on mount).
 */
const { navigate } = require('../../utils/navigation');

const NEW_NOTE_EVENT = 'app:new-note';

let pendingNewNote = null;

const dispatch = (name, detail) => {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* ignore */ }
};

const requestNewNote = (detail) => {
  pendingNewNote = { ...(detail || {}), at: Date.now() };
  navigate('notes');
  // Give the page a moment to mount; NotesPage ignores the event when it already consumed the flag.
  setTimeout(() => { if (pendingNewNote) dispatch(NEW_NOTE_EVENT, detail || {}); }, 120);
};

// Returns the pending request (and clears it) or null. Requests older than 10 s are dropped.
const consumePendingNewNote = () => {
  const p = pendingNewNote;
  pendingNewNote = null;
  if (!p || Date.now() - p.at > 10000) return null;
  return p;
};

module.exports = { NEW_NOTE_EVENT, requestNewNote, consumePendingNewNote };
