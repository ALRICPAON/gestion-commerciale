require('dotenv').config();

const db = require('../db');
const {
  processPennylaneClientSyncQueue,
  processPennylaneCustomerInvoiceSyncQueue,
  processPennylaneSupplierSyncQueue,
} = require('../services/pennylane');

const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 1000;

const syncTasks = [
  {
    name: 'clients',
    process: processPennylaneClientSyncQueue,
  },
  {
    name: 'fournisseurs',
    process: processPennylaneSupplierSyncQueue,
  },
  {
    name: 'factures_clients',
    process: processPennylaneCustomerInvoiceSyncQueue,
  },
];

const intervalMs = Math.max(
  Number(process.env.PENNYLANE_SYNC_DAEMON_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS
);
const workerPrefix = `pennylane-sync-daemon-${process.pid}`;

let stopping = false;
let running = false;
let timer = null;

function wait(ms) {
  return new Promise((resolve) => {
    timer = setTimeout(() => {
      timer = null;
      resolve();
    }, ms);
  });
}

function hasActivity(result) {
  return Boolean(result?.processed || result?.succeeded || result?.failed || result?.deferred);
}

function shouldLogSkipped(result) {
  return Boolean(result?.skipped && process.env.PENNYLANE_SYNC_DAEMON_LOG_SKIPPED === 'true');
}

async function runTask(task) {
  const startedAt = Date.now();
  const result = await task.process(db, {
    workerId: `${workerPrefix}-${task.name}`,
  });
  const durationMs = Date.now() - startedAt;

  if (hasActivity(result) || shouldLogSkipped(result)) {
    console.info('[Pennylane sync daemon] traitement termine', {
      task: task.name,
      duration_ms: durationMs,
      ...result,
    });
  }

  return result;
}

async function runCycle() {
  if (running) {
    console.warn('[Pennylane sync daemon] cycle ignore car un traitement est deja en cours');
    return false;
  }

  running = true;
  const cycleStartedAt = Date.now();
  let cycleHadActivity = false;

  try {
    for (const task of syncTasks) {
      if (stopping) break;

      try {
        const result = await runTask(task);
        cycleHadActivity = cycleHadActivity || hasActivity(result) || shouldLogSkipped(result);
      } catch (err) {
        cycleHadActivity = true;
        console.error('[Pennylane sync daemon] erreur traitement', {
          task: task.name,
          message: err.message,
          stack: err.stack,
        });
      }
    }
  } finally {
    running = false;
    if (cycleHadActivity) {
      console.info('[Pennylane sync daemon] cycle termine', {
        duration_ms: Date.now() - cycleStartedAt,
        next_cycle_in_ms: stopping ? null : intervalMs,
      });
    }
  }

  return cycleHadActivity;
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;

  console.info('[Pennylane sync daemon] arret demande', { signal });

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  while (running) {
    await wait(250);
  }

  await db.end();
  console.info('[Pennylane sync daemon] arret termine');
}

async function main() {
  console.info('[Pennylane sync daemon] demarrage', {
    interval_ms: intervalMs,
    pid: process.pid,
  });

  while (!stopping) {
    await runCycle();
    if (!stopping) await wait(intervalMs);
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Pennylane sync daemon] erreur pendant arret SIGINT', err);
      process.exit(1);
    });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Pennylane sync daemon] erreur pendant arret SIGTERM', err);
      process.exit(1);
    });
});

main().catch(async (err) => {
  console.error('[Pennylane sync daemon] erreur fatale', err);
  stopping = true;
  await db.end().catch(() => {});
  process.exit(1);
});
