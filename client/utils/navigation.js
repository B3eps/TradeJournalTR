/*
 * Lightweight global navigation bus for the app shell.
 *
 * Events (on window):
 *   'app:navigate'        detail: { page, itemId?, itemType? }  -> trades.jsx switches page
 *   'app:quick-add-task'  (no detail)                           -> TasksPage opens its quick-add input
 *   'app:open-palette'    (no detail)                           -> trades.jsx opens the command palette
 *
 * Pages read a pending item after mounting:
 *   const { consumePendingItem } = require('../../utils/navigation');
 *   useEffect(() => { const p = consumePendingItem('tasks'); if (p) focusTask(p.itemId); }, []);
 * and also listen to 'app:navigate' for navigations while already mounted.
 *
 * Quick add: TasksPage should, on mount, check consumePendingAction('quick-add-task')
 * and also listen for 'app:quick-add-task' (opening the input twice is harmless).
 */
const NAV_EVENT = 'app:navigate';
const QUICK_ADD_TASK_EVENT = 'app:quick-add-task';
const OPEN_PALETTE_EVENT = 'app:open-palette';
const NEW_TRADE_EVENT = 'app:new-trade';

let pendingItem = null;
const pendingActions = new Set();

const dispatch = (name, detail) => {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* ignore */ }
};

// Called by the shell when an 'app:navigate' event carries an itemId.
const setPendingItem = (detail) => {
  pendingItem = detail && detail.itemId != null
    ? { page: detail.page, itemId: detail.itemId, itemType: detail.itemType || null, at: Date.now() }
    : null;
};

const peekPendingItem = (page) => {
  if (!pendingItem) return null;
  if (page && pendingItem.page !== page) return null;
  return pendingItem;
};

const consumePendingItem = (page) => {
  const p = peekPendingItem(page);
  if (p) pendingItem = null;
  return p;
};

const navigate = (page, itemId, extra) => {
  dispatch(NAV_EVENT, { page, itemId: itemId != null ? itemId : null, ...(extra || {}) });
};

const consumePendingAction = (name) => {
  if (!pendingActions.has(name)) return false;
  pendingActions.delete(name);
  return true;
};

const requestQuickAddTask = () => {
  pendingActions.add('quick-add-task');
  navigate('tasks');
  // Give the Tasks page a moment to mount before signalling.
  setTimeout(() => dispatch(QUICK_ADD_TASK_EVENT), 120);
};

const openCommandPalette = () => dispatch(OPEN_PALETTE_EVENT);

// Opens the "new trade" form (a global modal owned by trades.jsx) without leaving the page.
const requestNewTrade = () => dispatch(NEW_TRADE_EVENT);

module.exports = {
  NAV_EVENT,
  QUICK_ADD_TASK_EVENT,
  OPEN_PALETTE_EVENT,
  NEW_TRADE_EVENT,
  navigate,
  setPendingItem,
  peekPendingItem,
  consumePendingItem,
  consumePendingAction,
  requestQuickAddTask,
  openCommandPalette,
  requestNewTrade,
};
