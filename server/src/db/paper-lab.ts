import type { Db } from './connection';
import { generateId } from '../utils/id';

const bad = (message: string): never => { throw new Error(message); };

export function getState(db: Db, userId: string) {
  const runs = db.prepare(`SELECT id, target, loss_guard AS lossGuard, mode, program,
    initial_balance AS initialBalance, max_daily_drawdown AS maxDailyDrawdown,
    max_total_drawdown AS maxTotalDrawdown, consistency_limit AS consistencyLimit,
    current_stage AS currentStage, status, created_at AS createdAt
    FROM paper_lab_runs WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as any[];
  const entries = db.prepare(`SELECT id, run_id AS runId, stage, symbol, side, quantity,
    entry_price AS entryPrice, exit_price AS exitPrice, multiplier, fees, note, pnl,
    created_at AS createdAt FROM paper_lab_entries WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
  return { runs: runs.map((r) => r.mode === 'prop' ? { ...r, ...calculateProgress(db, r) } : r), entries };
}

export function startRun(db: Db, userId: string, input: Record<string, unknown>) {
  const mode = input.mode === 'prop' ? 'prop' : 'stages';
  if (mode === 'prop') {
    const program = String(input.program || '');
    const initialBalance = Number(input.initialBalance);
    if (!['bem_one', 'bem_one_only'].includes(program)) bad('BEM One programını seçin.');
    if (![5000, 10000, 25000].includes(initialBalance)) bad('Hesap boyutu 5K, 10K veya 25K olmalı.');
    const targetPct = program === 'bem_one' ? 0.09 : 0.06;
    const target = initialBalance * targetPct;
    const dailyDd = initialBalance * 0.03;
    const totalDd = initialBalance * 0.06;
    const consistency = program === 'bem_one_only' ? 0.30 : null;
    const active = db.prepare("SELECT id FROM paper_lab_runs WHERE user_id = ? AND status = 'active'").get(userId);
    if (active) bad('Önce etkin paper denemesini kapatın.');
    const id = generateId(), createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO paper_lab_runs
      (id,user_id,target,loss_guard,mode,program,initial_balance,max_daily_drawdown,max_total_drawdown,consistency_limit,current_stage,status,created_at)
      VALUES (?,?,?,NULL,'prop',?,?,?,?,?,1,'active',?)`).run(id,userId,target,program,initialBalance,dailyDd,totalDd,consistency,createdAt);
    return { id, target, lossGuard: null, mode, program, initialBalance, maxDailyDrawdown: dailyDd,
      maxTotalDrawdown: totalDd, consistencyLimit: consistency, currentStage: 1, status: 'active', createdAt,
      balance: initialBalance, dailyFloor: initialBalance - dailyDd, totalFloor: initialBalance - totalDd, consistencyScore: 0 };
  }
  const target = Number(input.target);
  const guard = input.lossGuard == null || input.lossGuard === '' ? null : Number(input.lossGuard);
  if (!Number.isFinite(target) || target <= 0) bad('Hedef sıfırdan büyük olmalı.');
  if (guard !== null && (!Number.isFinite(guard) || guard <= 0)) bad('Zarar sınırı boş veya sıfırdan büyük olmalı.');
  const active = db.prepare("SELECT id FROM paper_lab_runs WHERE user_id = ? AND status = 'active'").get(userId);
  if (active) bad('Önce etkin denemeyi tamamlayın veya başarısız duruma getirin.');
  const id = generateId(), createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO paper_lab_runs (id,user_id,target,loss_guard,current_stage,status,created_at)
    VALUES (?,?,?,?,1,'active',?)`).run(id,userId,target,guard,createdAt);
  return { id, target, lossGuard: guard, currentStage: 1, status: 'active', createdAt };
}

function calculateProgress(db: Db, run: any) {
  const rows = db.prepare('SELECT pnl, created_at AS createdAt FROM paper_lab_entries WHERE run_id = ? ORDER BY created_at, id').all(run.id) as Array<{ pnl: number; createdAt: string }>;
  const initial = Number(run.initialBalance), dailyDd = Number(run.maxDailyDrawdown), totalDd = Number(run.maxTotalDrawdown);
  let balance = initial, peak = initial, totalFloor = initial - totalDd, dailyFloor = initial - dailyDd;
  let day = '', dayStartBalance = initial, dayPnl = 0, highestDayProfit = 0;
  const dailyPnl = new Map<string, number>();
  let status = 'active';
  for (const row of rows) {
    const time = Date.parse(row.createdAt);
    const key = Number.isFinite(time) ? new Date(time + 2 * 60 * 60 * 1000).toISOString().slice(0, 10) : row.createdAt.slice(0, 10);
    if (key !== day) {
      if (day) {
        highestDayProfit = Math.max(highestDayProfit, dayPnl);
        if (run.program === 'bem_one_only') totalFloor = Math.min(initial, Math.max(totalFloor, balance - totalDd));
      }
      day = key; dayStartBalance = balance; dayPnl = 0; dailyFloor = dayStartBalance - dailyDd;
    }
    balance += Number(row.pnl); dayPnl += Number(row.pnl);
    dailyPnl.set(key, (dailyPnl.get(key) || 0) + Number(row.pnl));
    if (balance < dailyFloor || balance < totalFloor) { status = 'failed'; break; }
    if (run.program === 'bem_one') {
      peak = Math.max(peak, balance);
      totalFloor = Math.min(initial, Math.max(totalFloor, peak - totalDd));
    }
  }
  const nowKey = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (day && nowKey !== day) {
    if (run.program === 'bem_one_only') totalFloor = Math.min(initial, Math.max(totalFloor, balance - totalDd));
    dailyFloor = balance - dailyDd;
  }
  highestDayProfit = Math.max(highestDayProfit, dayPnl);
  const totalProfit = balance - initial;
  const consistencyScore = totalProfit > 0 ? highestDayProfit / totalProfit : 0;
  if (status !== 'failed' && totalProfit >= Number(run.target) &&
      (run.consistencyLimit == null || consistencyScore <= Number(run.consistencyLimit))) status = 'completed';
  const highestDay = Math.max(0, ...dailyPnl.values());
  const score = totalProfit > 0 ? highestDay / totalProfit : 0;
  return { balance, dailyFloor, totalFloor, consistencyScore: score, totalProfit, status };
}

function updateRunProgress(db: Db, runId: string) {
  const run = db.prepare(`SELECT id, target, loss_guard AS lossGuard, mode, program, initial_balance AS initialBalance,
    max_daily_drawdown AS maxDailyDrawdown, max_total_drawdown AS maxTotalDrawdown, consistency_limit AS consistencyLimit
    FROM paper_lab_runs WHERE id = ?`).get(runId) as any;
  if (run.mode === 'prop') {
    const progress = calculateProgress(db, run);
    db.prepare('UPDATE paper_lab_runs SET current_stage = 1, status = ? WHERE id = ?').run(progress.status, runId);
    return { currentStage: 1, ...progress };
  }
  let currentStage = 1, status = 'active';
  for (let stage = 1; stage <= 3; stage++) {
    const pnl = db.prepare('SELECT COALESCE(SUM(pnl),0) AS pnl FROM paper_lab_entries WHERE run_id = ? AND stage = ?').get(runId,stage) as { pnl: number };
    if (run.lossGuard != null && pnl.pnl <= -run.lossGuard) { status = 'failed'; currentStage = stage; break; }
    if (pnl.pnl >= run.target) { currentStage = stage + 1; continue; }
    currentStage = stage; break;
  }
  if (currentStage === 4) { currentStage = 3; status = 'completed'; }
  db.prepare('UPDATE paper_lab_runs SET current_stage = ?, status = ? WHERE id = ?').run(currentStage,status,runId);
  return { currentStage, status };
}

export function createEntry(db: Db, userId: string, input: Record<string, unknown>) {
  const runId = String(input.runId || '');
  const run = db.prepare('SELECT id, current_stage AS currentStage, status FROM paper_lab_runs WHERE id = ? AND user_id = ?').get(runId,userId) as any;
  if (!run) bad('Deneme bulunamadı.');
  if (run.status !== 'active') bad('Bu denemede yeni kayıt alınamaz.');
  const quantity = Number(input.quantity), entry = Number(input.entryPrice), exit = Number(input.exitPrice);
  const multiplier = input.multiplier == null || input.multiplier === '' ? 1 : Number(input.multiplier);
  const fees = input.fees == null || input.fees === '' ? 0 : Number(input.fees);
  const symbol = String(input.symbol || '').trim().slice(0,32);
  const side = String(input.side || '');
  if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(entry) || entry <= 0 ||
      !Number.isFinite(exit) || exit <= 0 || !Number.isFinite(multiplier) || multiplier <= 0 ||
      !Number.isFinite(fees) || fees < 0 || !['long', 'short'].includes(side)) bad('Sembol, yön, pozitif miktar/fiyat/çarpan ve geçerli masraf girin.');
  const pnl = (side === 'long' ? exit - entry : entry - exit) * quantity * multiplier - fees;
  const id = generateId(), createdAt = new Date().toISOString(), stage = Number(run.currentStage);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO paper_lab_entries
      (id,user_id,run_id,stage,symbol,side,quantity,entry_price,exit_price,multiplier,fees,note,pnl,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,userId,runId,stage,symbol,side,quantity,entry,exit,multiplier,fees,String(input.note || '').slice(0,1000),pnl,createdAt);
    const progress = updateRunProgress(db,runId);
    return progress;
  });
  const progress = tx();
  return { id, runId, stage, symbol, side, quantity, entryPrice: entry, exitPrice: exit, multiplier, fees,
    note: String(input.note || '').slice(0,1000), pnl, createdAt, ...progress };
}

export function deleteEntry(db: Db, userId: string, id: string) {
  const row = db.prepare('SELECT e.run_id AS runId, r.status AS status FROM paper_lab_entries e LEFT JOIN paper_lab_runs r ON r.id = e.run_id WHERE e.id = ? AND e.user_id = ?').get(id,userId) as { runId: string | null; status: string | null } | undefined;
  if (!row) return false;
  if (row.runId && row.status !== 'active') bad('Kapanmış denemelerin kayıtları değiştirilemez.');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM paper_lab_entries WHERE id = ? AND user_id = ?').run(id,userId);
    if (row.runId) updateRunProgress(db,row.runId);
  });
  tx();
  return true;
}
