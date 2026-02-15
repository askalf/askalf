import 'dotenv/config';
import http from 'http';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { initializePool, query } from '@substrate/database';
import { initializeAI } from '@substrate/ai';
import { initializeEventBus } from '@substrate/events';
import { initializeLogger, getLogger } from '@substrate/observability';
import { runCrystallizeCycle, runDecayCycle, runPromoteCycle, runRecalibrateCycle, runChallengeCycle, runFeedbackCycle, runEvolveCycle, runClassifierSeed, DEFAULT_METABOLIC_CONFIG } from '@substrate/metabolic';

// Initialize services
initializeLogger();
const logger = getLogger();

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const isScheduler = process.env['WORKER_ROLE'] === 'scheduler';
const workerId = process.env['WORKER_ID'] ?? `worker-${process.pid}`;
const healthPort = parseInt(process.env['HEALTH_PORT'] ?? '8081', 10);

// ===========================================
// CONFIGURABLE SCHEDULES (Issue #5)
// Override via environment variables
// ===========================================
const SCHEDULES = {
  crystallize: process.env['SCHEDULE_CRYSTALLIZE'] ?? DEFAULT_METABOLIC_CONFIG.crystallizeSchedule,
  promote: process.env['SCHEDULE_PROMOTE'] ?? DEFAULT_METABOLIC_CONFIG.promoteSchedule,
  decay: process.env['SCHEDULE_DECAY'] ?? DEFAULT_METABOLIC_CONFIG.decaySchedule,
  recalibrate: process.env['SCHEDULE_RECALIBRATE'] ?? '0 */6 * * *', // Every 6 hours
  metacognition: process.env['SCHEDULE_METACOGNITION'] ?? '0 * * * *',
  challenge: process.env['SCHEDULE_CHALLENGE'] ?? DEFAULT_METABOLIC_CONFIG.challengeSchedule,
  feedback: process.env['SCHEDULE_FEEDBACK'] ?? '*/15 * * * *', // Every 15 minutes
  evolve: process.env['SCHEDULE_EVOLVE'] ?? DEFAULT_METABOLIC_CONFIG.evolveSchedule, // Every hour
  classifierSeed: process.env['SCHEDULE_CLASSIFIER_SEED'] ?? '0 4 * * *', // Daily at 4 AM
};

// ===========================================
// SCHEDULER STATE (for health checks - Issue #1)
// ===========================================
interface SchedulerState {
  hasLock: boolean;
  lockAcquiredAt: Date | null;
  lastHeartbeat: Date | null;
  lastScheduleRun: Date | null;
  jobsScheduled: number;
  isBackup: boolean;
  dbConnected: boolean;
  redisConnected: boolean;
}

const schedulerState: SchedulerState = {
  hasLock: false,
  lockAcquiredAt: null,
  lastHeartbeat: null,
  lastScheduleRun: null,
  jobsScheduled: 0,
  isBackup: false,
  dbConnected: false,
  redisConnected: false,
};

// Concurrency configuration (can be overridden via env)
const CONCURRENCY = {
  crystallize: parseInt(process.env['CONCURRENCY_CRYSTALLIZE'] ?? '2', 10),
  promote: parseInt(process.env['CONCURRENCY_PROMOTE'] ?? '2', 10),
  decay: parseInt(process.env['CONCURRENCY_DECAY'] ?? '1', 10),
  recalibrate: parseInt(process.env['CONCURRENCY_RECALIBRATE'] ?? '1', 10),
  challenge: parseInt(process.env['CONCURRENCY_CHALLENGE'] ?? '1', 10),
  feedback: parseInt(process.env['CONCURRENCY_FEEDBACK'] ?? '1', 10),
  evolve: parseInt(process.env['CONCURRENCY_EVOLVE'] ?? '1', 10),
  classifierSeed: parseInt(process.env['CONCURRENCY_CLASSIFIER_SEED'] ?? '1', 10),
  trace: parseInt(process.env['CONCURRENCY_TRACE'] ?? '10', 10),
  execute: parseInt(process.env['CONCURRENCY_EXECUTE'] ?? '20', 10),
};

// ===========================================
// RATE LIMITS (Issue #3: Make configurable)
// ===========================================
const RATE_LIMITS = {
  crystallizeMax: parseInt(process.env['RATE_LIMIT_CRYSTALLIZE'] ?? '10', 10),
  crystallizeDuration: parseInt(process.env['RATE_LIMIT_CRYSTALLIZE_DURATION'] ?? '60000', 10),
};

// ===========================================
// JOB TIMEOUTS (Issue #4)
// ===========================================
const JOB_TIMEOUTS = {
  crystallize: parseInt(process.env['TIMEOUT_CRYSTALLIZE'] ?? '480000', 10), // 8 min
  promote: parseInt(process.env['TIMEOUT_PROMOTE'] ?? '120000', 10), // 2 min
  decay: parseInt(process.env['TIMEOUT_DECAY'] ?? '120000', 10), // 2 min
  recalibrate: parseInt(process.env['TIMEOUT_RECALIBRATE'] ?? '120000', 10), // 2 min
  challenge: parseInt(process.env['TIMEOUT_CHALLENGE'] ?? '300000', 10), // 5 min (LLM calls per shard)
  feedback: parseInt(process.env['TIMEOUT_FEEDBACK'] ?? '180000', 10), // 3 min (embedding calls)
  evolve: parseInt(process.env['TIMEOUT_EVOLVE'] ?? '600000', 10), // 10 min (cross-model LLM + sandbox)
  classifierSeed: parseInt(process.env['TIMEOUT_CLASSIFIER_SEED'] ?? '300000', 10), // 5 min (batch LLM calls)
  metacognition: parseInt(process.env['TIMEOUT_METACOGNITION'] ?? '60000', 10), // 1 min
  trace: parseInt(process.env['TIMEOUT_TRACE'] ?? '30000', 10), // 30 sec
  execute: parseInt(process.env['TIMEOUT_EXECUTE'] ?? '30000', 10), // 30 sec
};

// ===========================================
// RETRY CONFIGURATION (Issue #1)
// ===========================================
const RETRY_CONFIG = {
  metabolic: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
  },
  trace: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
  },
  execute: {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 500 },
  },
};

// ===========================================
// CIRCUIT BREAKER (Issue #9)
// ===========================================
interface CircuitBreakerState {
  failures: number;
  lastFailure: Date | null;
  isOpen: boolean;
  halfOpenAt: Date | null;
}

const CIRCUIT_BREAKER_THRESHOLD = 5; // failures before opening
const CIRCUIT_BREAKER_RESET_MS = 60000; // 1 minute before half-open

const circuitBreakers: Record<string, CircuitBreakerState> = {
  crystallize: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  promote: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  decay: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  recalibrate: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  challenge: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  feedback: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  evolve: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  classifierSeed: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
  metacognition: { failures: 0, lastFailure: null, isOpen: false, halfOpenAt: null },
};

function recordSuccess(queue: string) {
  const cb = circuitBreakers[queue];
  if (cb) {
    cb.failures = 0;
    cb.isOpen = false;
    cb.halfOpenAt = null;
  }
}

function recordFailure(queue: string): boolean {
  const cb = circuitBreakers[queue];
  if (!cb) return false;

  cb.failures++;
  cb.lastFailure = new Date();

  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.isOpen = true;
    cb.halfOpenAt = new Date(Date.now() + CIRCUIT_BREAKER_RESET_MS);
    logger.warn({ queue, failures: cb.failures }, 'Circuit breaker OPEN');
    return true;
  }
  return false;
}

function isCircuitOpen(queue: string): boolean {
  const cb = circuitBreakers[queue];
  if (!cb || !cb.isOpen) return false;

  // Check if we should try half-open
  if (cb.halfOpenAt && new Date() >= cb.halfOpenAt) {
    logger.info({ queue }, 'Circuit breaker HALF-OPEN, allowing test request');
    return false; // Allow one request through
  }

  return true;
}

// ===========================================
// WORKER STATE (Issue #7: Health checks)
// ===========================================
interface WorkerState {
  startedAt: Date | null;
  dbConnected: boolean;
  redisConnected: boolean;
  jobsProcessed: number;
  jobsFailed: number;
  lastJobAt: Date | null;
  activeJobs: number;
  circuitBreakers: typeof circuitBreakers;
}

const workerState: WorkerState = {
  startedAt: null,
  dbConnected: false,
  redisConnected: false,
  jobsProcessed: 0,
  jobsFailed: 0,
  lastJobAt: null,
  activeJobs: 0,
  circuitBreakers,
};

// Parse Redis URL for BullMQ connection
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

const redisConfig = parseRedisUrl(redisUrl);

// Queue names (BullMQ doesn't allow colons in queue names)
const QUEUES = {
  CRYSTALLIZE: 'substrate-crystallize',
  PROMOTE: 'substrate-promote',
  DECAY: 'substrate-decay',
  RECALIBRATE: 'substrate-recalibrate',
  METACOGNITION: 'substrate-metacognition',
  CHALLENGE: 'substrate-challenge',
  FEEDBACK: 'substrate-feedback',
  EVOLVE: 'substrate-evolve',
  CLASSIFIER_SEED: 'substrate-classifier-seed',
  TRACE_INGEST: 'substrate-trace-ingest',
  SHARD_EXECUTE: 'substrate-shard-execute',
} as const;

// Data retention policy: EVERYTHING persists forever for all tiers
// Chat history, shards, facts, episodes - nothing is deleted
// This is our core value prop: "ALF never forgets"
// -1 = unlimited/forever
const DATA_RETENTION_DAYS: Record<string, number> = {
  free: -1,       // Forever
  basic: -1,      // Forever
  pro: -1,        // Forever
  team: -1,       // Forever
  enterprise: -1, // Forever
  system: -1,     // Forever
};

// ============================================
// SCHEDULER MODE - Only one instance should run this
// ============================================

const LOCK_KEY = 'substrate-scheduler-lock';
const LOCK_RELEASE_CHANNEL = 'substrate-scheduler-lock-release';
const LOCK_TTL = 60; // seconds
const HEARTBEAT_INTERVAL = 25000; // 25 seconds (well under 60s TTL)
const SHUTDOWN_TIMEOUT = 5000; // 5 second max shutdown time

async function runScheduler() {
  logger.info({ workerId, schedules: SCHEDULES }, 'Starting as SCHEDULER - managing job schedules');

  // ===========================================
  // Issue #4: Database startup validation
  // ===========================================
  logger.info('Validating database connection...');
  try {
    const dbCheck = await query<{ ok: number }>('SELECT 1 as ok');
    if (!dbCheck || dbCheck.length === 0) {
      throw new Error('Database query returned no results');
    }
    schedulerState.dbConnected = true;
    logger.info('Database connection validated');
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Database validation failed - cannot start scheduler');
    process.exit(1);
  }

  // Create queues for scheduling
  logger.info('Creating queues...');
  const crystallizeQueue = new Queue(QUEUES.CRYSTALLIZE, { connection: redisConfig });
  const promoteQueue = new Queue(QUEUES.PROMOTE, { connection: redisConfig });
  const decayQueue = new Queue(QUEUES.DECAY, { connection: redisConfig });
  const recalibrateQueue = new Queue(QUEUES.RECALIBRATE, { connection: redisConfig });
  const metacogQueue = new Queue(QUEUES.METACOGNITION, { connection: redisConfig });
  const challengeQueue = new Queue(QUEUES.CHALLENGE, { connection: redisConfig });
  const feedbackQueue = new Queue(QUEUES.FEEDBACK, { connection: redisConfig });
  const evolveQueue = new Queue(QUEUES.EVOLVE, { connection: redisConfig });
  const classifierSeedQueue = new Queue(QUEUES.CLASSIFIER_SEED, { connection: redisConfig });
  logger.info('Queues created');

  // Acquire distributed lock for scheduling (prevents race conditions)
  logger.info('Connecting to Redis for lock...');
  const redis = new Redis(redisUrl);

  // ===========================================
  // Issue #3: Redis PubSub for instant failover
  // ===========================================
  const subscriber = new Redis(redisUrl);

  // Wait for Redis connection
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
    redis.once('ready', () => {
      clearTimeout(timeout);
      schedulerState.redisConnected = true;
      logger.info('Redis connected');
      resolve();
    });
    redis.once('error', (err: Error) => {
      clearTimeout(timeout);
      logger.error({ error: err.message }, 'Redis connection error');
      reject(err);
    });
  });

  // Try to acquire scheduler lock
  const acquired = await redis.set(LOCK_KEY, workerId, 'EX', LOCK_TTL, 'NX');

  if (!acquired) {
    const currentHolder = await redis.get(LOCK_KEY);
    logger.warn({ currentHolder }, 'Another scheduler is active, running as backup');
    schedulerState.isBackup = true;

    // ===========================================
    // Issue #3: Subscribe to lock release for instant failover
    // ===========================================
    await subscriber.subscribe(LOCK_RELEASE_CHANNEL);
    logger.info('Subscribed to lock release channel for instant failover');

    subscriber.on('message', async (channel, message) => {
      if (channel === LOCK_RELEASE_CHANNEL) {
        logger.info({ releasedBy: message }, 'Lock release notification received, attempting to acquire');
        const acquired = await redis.set(LOCK_KEY, workerId, 'EX', LOCK_TTL, 'NX');
        if (acquired) {
          schedulerState.hasLock = true;
          schedulerState.lockAcquiredAt = new Date();
          schedulerState.isBackup = false;
          logger.info('Acquired scheduler lock via instant failover');
          await scheduleJobs(crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue);
          startHeartbeat(redis, crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue);
        }
      }
    });

    // Also poll as fallback (in case pubsub message is missed)
    const pollInterval = setInterval(async () => {
      if (schedulerState.hasLock) {
        clearInterval(pollInterval);
        return;
      }
      const acquired = await redis.set(LOCK_KEY, workerId, 'EX', LOCK_TTL, 'NX');
      if (acquired) {
        schedulerState.hasLock = true;
        schedulerState.lockAcquiredAt = new Date();
        schedulerState.isBackup = false;
        logger.info('Acquired scheduler lock via polling');
        await scheduleJobs(crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue);
        startHeartbeat(redis, crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue);
        clearInterval(pollInterval);
      }
    }, 30000);

    // Start health server for backup scheduler too
    startHealthServer();

    process.on('SIGTERM', async () => {
      await gracefulShutdown(redis, subscriber, [crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue], pollInterval);
    });
    return;
  }

  // We have the lock - schedule jobs and maintain heartbeat
  schedulerState.hasLock = true;
  schedulerState.lockAcquiredAt = new Date();
  logger.info('Acquired scheduler lock, scheduling metabolic jobs');
  await scheduleJobs(crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue);

  // Start heartbeat
  const heartbeatInterval = startHeartbeat(redis, crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue);

  // ===========================================
  // Issue #1: Start health check server
  // ===========================================
  startHealthServer();

  // Handle shutdown
  process.on('SIGTERM', async () => {
    await gracefulShutdown(redis, subscriber, [crystallizeQueue, promoteQueue, decayQueue, recalibrateQueue, metacogQueue, challengeQueue, feedbackQueue, evolveQueue, classifierSeedQueue], heartbeatInterval);
  });
}

function startHeartbeat(
  redis: Redis,
  crystallizeQueue: Queue,
  promoteQueue: Queue,
  decayQueue: Queue,
  recalibrateQueue: Queue,
  metacogQueue: Queue,
  challengeQueue?: Queue,
  feedbackQueue?: Queue,
  evolveQueue?: Queue,
  classifierSeedQueue?: Queue
): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      await redis.set(LOCK_KEY, workerId, 'EX', LOCK_TTL);
      schedulerState.lastHeartbeat = new Date();
      logger.debug('Scheduler heartbeat');
    } catch (err) {
      logger.error({ error: err }, 'Heartbeat failed');
      schedulerState.hasLock = false;
    }
  }, HEARTBEAT_INTERVAL);
}

async function gracefulShutdown(
  redis: Redis,
  subscriber: Redis,
  queues: Queue[],
  intervalId?: ReturnType<typeof setInterval>
) {
  logger.info('Scheduler shutting down...');

  // Set shutdown timeout to prevent hanging
  const forceExit = setTimeout(() => {
    logger.warn('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    if (intervalId) clearInterval(intervalId);

    // ===========================================
    // Issue #3: Notify backup schedulers of lock release
    // ===========================================
    if (schedulerState.hasLock) {
      await redis.publish(LOCK_RELEASE_CHANNEL, workerId);
      await redis.del(LOCK_KEY);
      logger.info('Lock released and notification published');
    }

    await subscriber.unsubscribe(LOCK_RELEASE_CHANNEL);
    await Promise.all(queues.map(q => q.close()));
    await subscriber.quit();
    await redis.quit();

    clearTimeout(forceExit);
    logger.info('Scheduler shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ error: err }, 'Error during shutdown');
    clearTimeout(forceExit);
    process.exit(1);
  }
}

// ===========================================
// Issue #1: Health check HTTP server
// ===========================================
function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const now = new Date();
      const heartbeatAge = schedulerState.lastHeartbeat
        ? now.getTime() - schedulerState.lastHeartbeat.getTime()
        : null;

      // Health check criteria for primary scheduler:
      // 1. Has lock OR is backup
      // 2. Database connected
      // 3. Redis connected
      // 4. Heartbeat within 2x interval (if primary)
      const isHealthy = schedulerState.isBackup
        ? schedulerState.redisConnected
        : schedulerState.hasLock &&
          schedulerState.dbConnected &&
          schedulerState.redisConnected &&
          (heartbeatAge === null || heartbeatAge < HEARTBEAT_INTERVAL * 2);

      const status = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        role: schedulerState.isBackup ? 'backup' : 'primary',
        workerId,
        hasLock: schedulerState.hasLock,
        lockAcquiredAt: schedulerState.lockAcquiredAt?.toISOString() ?? null,
        lastHeartbeat: schedulerState.lastHeartbeat?.toISOString() ?? null,
        heartbeatAgeMs: heartbeatAge,
        lastScheduleRun: schedulerState.lastScheduleRun?.toISOString() ?? null,
        jobsScheduled: schedulerState.jobsScheduled,
        dbConnected: schedulerState.dbConnected,
        redisConnected: schedulerState.redisConnected,
        schedules: SCHEDULES,
      };

      res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(healthPort, '0.0.0.0', () => {
    logger.info({ port: healthPort }, 'Health check server started');
  });
}

async function scheduleJobs(
  crystallizeQueue: Queue,
  promoteQueue: Queue,
  decayQueue: Queue,
  recalibrateQueue: Queue,
  metacogQueue?: Queue,
  challengeQueue?: Queue,
  feedbackQueue?: Queue,
  evolveQueue?: Queue,
  classifierSeedQueue?: Queue
) {
  let jobsScheduled = 0;

  // Clear existing repeatable jobs (idempotent)
  const crystallizeJobs = await crystallizeQueue.getRepeatableJobs();
  for (const job of crystallizeJobs) {
    await crystallizeQueue.removeRepeatableByKey(job.key);
  }

  const promoteJobs = await promoteQueue.getRepeatableJobs();
  for (const job of promoteJobs) {
    await promoteQueue.removeRepeatableByKey(job.key);
  }

  const decayJobs = await decayQueue.getRepeatableJobs();
  for (const job of decayJobs) {
    await decayQueue.removeRepeatableByKey(job.key);
  }

  // ===========================================
  // Issue #5: Use configurable schedules
  // ===========================================
  await crystallizeQueue.add(
    'crystallize',
    { scheduled: true },
    {
      repeat: { pattern: SCHEDULES.crystallize },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: 'scheduled-crystallize',
    }
  );
  jobsScheduled++;

  await promoteQueue.add(
    'promote',
    { scheduled: true },
    {
      repeat: { pattern: SCHEDULES.promote },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: 'scheduled-promote',
    }
  );
  jobsScheduled++;

  await decayQueue.add(
    'decay',
    { scheduled: true },
    {
      repeat: { pattern: SCHEDULES.decay },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: 'scheduled-decay',
    }
  );
  jobsScheduled++;

  // Recalibrate job - fix confidence drift
  const recalibrateJobs = await recalibrateQueue.getRepeatableJobs();
  for (const job of recalibrateJobs) {
    await recalibrateQueue.removeRepeatableByKey(job.key);
  }
  await recalibrateQueue.add(
    'recalibrate',
    { scheduled: true },
    {
      repeat: { pattern: SCHEDULES.recalibrate },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: 'scheduled-recalibrate',
    }
  );
  jobsScheduled++;

  // Metacognition job
  if (metacogQueue) {
    const metacogJobs = await metacogQueue.getRepeatableJobs();
    for (const job of metacogJobs) {
      await metacogQueue.removeRepeatableByKey(job.key);
    }
    await metacogQueue.add(
      'metacognition',
      { scheduled: true },
      {
        repeat: { pattern: SCHEDULES.metacognition },
        removeOnComplete: 50,
        removeOnFail: 50,
        jobId: 'scheduled-metacognition',
      }
    );
    jobsScheduled++;
  }

  // Challenge job - nightly shard verification
  if (challengeQueue) {
    const challengeJobs = await challengeQueue.getRepeatableJobs();
    for (const job of challengeJobs) {
      await challengeQueue.removeRepeatableByKey(job.key);
    }
    await challengeQueue.add(
      'challenge',
      { scheduled: true },
      {
        repeat: { pattern: SCHEDULES.challenge },
        removeOnComplete: 50,
        removeOnFail: 50,
        jobId: 'scheduled-challenge',
      }
    );
    jobsScheduled++;
  }

  // Feedback job - user signal detection after shard hits
  if (feedbackQueue) {
    const feedbackJobs = await feedbackQueue.getRepeatableJobs();
    for (const job of feedbackJobs) {
      await feedbackQueue.removeRepeatableByKey(job.key);
    }
    await feedbackQueue.add(
      'feedback',
      { scheduled: true },
      {
        repeat: { pattern: SCHEDULES.feedback },
        removeOnComplete: 100,
        removeOnFail: 50,
        jobId: 'scheduled-feedback',
      }
    );
    jobsScheduled++;
  }

  // Evolve job - cross-model shard improvement
  if (evolveQueue) {
    const evolveJobs = await evolveQueue.getRepeatableJobs();
    for (const job of evolveJobs) {
      await evolveQueue.removeRepeatableByKey(job.key);
    }
    await evolveQueue.add(
      'evolve',
      { scheduled: true },
      {
        repeat: { pattern: SCHEDULES.evolve },
        removeOnComplete: 50,
        removeOnFail: 50,
        jobId: 'scheduled-evolve',
      }
    );
    jobsScheduled++;
  }

  // Classifier seed job - shadow classifier training data
  if (classifierSeedQueue) {
    const classifierSeedJobs = await classifierSeedQueue.getRepeatableJobs();
    for (const job of classifierSeedJobs) {
      await classifierSeedQueue.removeRepeatableByKey(job.key);
    }
    await classifierSeedQueue.add(
      'classifier-seed',
      { scheduled: true },
      {
        repeat: { pattern: SCHEDULES.classifierSeed },
        removeOnComplete: 50,
        removeOnFail: 50,
        jobId: 'scheduled-classifier-seed',
      }
    );
    jobsScheduled++;
  }

  // Update scheduler state for health checks
  schedulerState.lastScheduleRun = new Date();
  schedulerState.jobsScheduled = jobsScheduled;

  logger.info({
    crystallize: SCHEDULES.crystallize,
    promote: SCHEDULES.promote,
    decay: SCHEDULES.decay,
    recalibrate: SCHEDULES.recalibrate,
    metacognition: SCHEDULES.metacognition,
    challenge: SCHEDULES.challenge,
    feedback: SCHEDULES.feedback,
    evolve: SCHEDULES.evolve,
    classifierSeed: SCHEDULES.classifierSeed,
    jobsScheduled,
  }, 'Metabolic jobs scheduled');
}

// ============================================
// WORKER MODE - Processes jobs (can scale horizontally)
// ============================================
async function runWorker() {
  logger.info({ workerId, concurrency: CONCURRENCY }, 'Starting as WORKER - processing jobs');

  // ===========================================
  // Issue #6: Database startup validation
  // ===========================================
  logger.info('Validating database connection...');
  try {
    const dbCheck = await query<{ ok: number }>('SELECT 1 as ok');
    if (!dbCheck || dbCheck.length === 0) {
      throw new Error('Database query returned no results');
    }
    workerState.dbConnected = true;
    logger.info('Database connection validated');
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Database validation failed - cannot start worker');
    process.exit(1);
  }

  // Validate Redis connection
  const testRedis = new Redis(redisUrl);
  try {
    await testRedis.ping();
    workerState.redisConnected = true;
    logger.info('Redis connection validated');
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Redis validation failed - cannot start worker');
    process.exit(1);
  } finally {
    await testRedis.quit();
  }

  workerState.startedAt = new Date();

  // Helper to wrap job handlers with circuit breaker and metrics
  function wrapJobHandler<T>(
    queueName: string,
    handler: () => Promise<T>
  ): () => Promise<T> {
    return async () => {
      if (isCircuitOpen(queueName)) {
        throw new Error(`Circuit breaker OPEN for ${queueName}`);
      }

      workerState.activeJobs++;
      try {
        const result = await handler();
        recordSuccess(queueName);
        workerState.jobsProcessed++;
        workerState.lastJobAt = new Date();
        return result;
      } catch (err) {
        recordFailure(queueName);
        workerState.jobsFailed++;
        throw err;
      } finally {
        workerState.activeJobs--;
      }
    };
  }

  // ===========================================
  // METABOLIC WORKERS (with retry, timeout, circuit breaker)
  // ===========================================

  const crystallizeWorker = new Worker(
    QUEUES.CRYSTALLIZE,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing crystallize job');

      return wrapJobHandler('crystallize', async () => {
        const result = await runCrystallizeCycle({ minTracesPerCluster: 2 });
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          ...result
        }, 'Crystallize job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.crystallize,
      lockDuration: JOB_TIMEOUTS.crystallize,
      limiter: {
        max: RATE_LIMITS.crystallizeMax,
        duration: RATE_LIMITS.crystallizeDuration,
      },
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  const promoteWorker = new Worker(
    QUEUES.PROMOTE,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing promote job');

      return wrapJobHandler('promote', async () => {
        const result = await runPromoteCycle();
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          ...result
        }, 'Promote job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.promote,
      lockDuration: JOB_TIMEOUTS.promote,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  const decayWorker = new Worker(
    QUEUES.DECAY,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing decay job');

      return wrapJobHandler('decay', async () => {
        const result = await runDecayCycle();
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          ...result
        }, 'Decay job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.decay,
      lockDuration: JOB_TIMEOUTS.decay,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  // Recalibrate worker - fix confidence drift
  const recalibrateWorker = new Worker(
    QUEUES.RECALIBRATE,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing recalibrate job');

      return wrapJobHandler('recalibrate', async () => {
        const result = await runRecalibrateCycle();
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          checked: result.checked,
          recalibrated: result.recalibrated,
        }, 'Recalibrate job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.recalibrate,
      lockDuration: JOB_TIMEOUTS.recalibrate,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  // Challenge worker - nightly shard verification (Layer 2)
  const challengeWorker = new Worker(
    QUEUES.CHALLENGE,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing challenge job');

      return wrapJobHandler('challenge', async () => {
        const result = await runChallengeCycle();
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          ...result
        }, 'Challenge job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.challenge,
      lockDuration: JOB_TIMEOUTS.challenge,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  // Feedback worker - user signal detection after shard hits (Layer 5)
  const feedbackWorker = new Worker(
    QUEUES.FEEDBACK,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing feedback job');

      return wrapJobHandler('feedback', async () => {
        const result = await runFeedbackCycle();
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          ...result
        }, 'Feedback job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.feedback,
      lockDuration: JOB_TIMEOUTS.feedback,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  // Evolve worker - cross-model shard improvement (Layer 4)
  const evolveWorker = new Worker(
    QUEUES.EVOLVE,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing evolve job');

      return wrapJobHandler('evolve', async () => {
        const result = await runEvolveCycle();
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          processed: result.processed,
          evolved: result.evolved,
          failed: result.failed,
        }, 'Evolve job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.evolve,
      lockDuration: JOB_TIMEOUTS.evolve,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  // Classifier seed worker - shadow classifier training data (Layer 3)
  const classifierSeedWorker = new Worker(
    QUEUES.CLASSIFIER_SEED,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing classifier-seed job');

      return wrapJobHandler('classifierSeed', async () => {
        const result = await runClassifierSeed();
        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          processed: result.processed,
          withCandidates: result.withCandidates,
          agreements: result.agreementsWithExisting,
          disagreements: result.disagreementsWithExisting,
        }, 'Classifier seed job complete');
        return result;
      })();
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.classifierSeed,
      lockDuration: JOB_TIMEOUTS.classifierSeed,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.metabolic.backoff.delay * Math.pow(2, attemptsMade), 60000);
        },
      },
    }
  );

  // Metacognition worker - self-reflective analysis
  const metacogWorker = new Worker(
    QUEUES.METACOGNITION,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, attempt: job.attemptsMade + 1 }, 'Processing metacognition job');

      return wrapJobHandler('metacognition', async () => {
        // 1. Analyze recent shard performance and adjust confidence
        // Issue #8: Query uses index on (shard_id, created_at) - see migration
        const shardStats = await query<{
          shard_id: string;
          executions: string;
          successes: string;
          current_confidence: number;
        }>(`
          SELECT
            se.shard_id,
            COUNT(*) as executions,
            COUNT(*) FILTER (WHERE se.success = true) as successes,
            ps.confidence as current_confidence
          FROM shard_executions se
          JOIN procedural_shards ps ON se.shard_id = ps.id
          WHERE se.created_at > NOW() - INTERVAL '1 hour'
          GROUP BY se.shard_id, ps.confidence
          HAVING COUNT(*) >= 10
        `);

        let adjustments = 0;
        for (const stat of shardStats) {
          const successRate = parseInt(stat.successes, 10) / parseInt(stat.executions, 10);
          const targetConfidence = successRate;
          const diff = targetConfidence - stat.current_confidence;

          // Only adjust if significant difference (>5%)
          if (Math.abs(diff) > 0.05) {
            const adjustment = Math.max(-0.1, Math.min(0.1, diff * 0.5));
            await query(`SELECT adjust_shard_confidence($1, $2, $3)`, [
              stat.shard_id,
              adjustment,
              `Hourly metacog: ${parseInt(stat.executions, 10)} executions, ${(successRate * 100).toFixed(1)}% success`,
            ]);
            adjustments++;
          }
        }

        // 2. Record metacognition event
        await query(
          `SELECT record_metacognition_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            'quality_check',
            JSON.stringify({
              shardsAnalyzed: shardStats.length,
              confidenceAdjustments: adjustments,
              hourly: true,
            }),
            null, null, null, null, null,
            0.9,
            'hourly_analysis',
            `Analyzed ${shardStats.length} shards, adjusted ${adjustments}`,
            true,
            Date.now() - start,
          ]
        );

        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          shardsAnalyzed: shardStats.length,
          adjustments,
        }, 'Metacognition job complete');

        return { shardsAnalyzed: shardStats.length, adjustments };
      })();
    },
    {
      connection: redisConfig,
      concurrency: 1, // Only one metacog job at a time
      lockDuration: JOB_TIMEOUTS.metacognition,
    }
  );

  // ===========================================
  // Issue #2: Implement actual trace ingestion
  // ===========================================
  const traceWorker = new Worker(
    QUEUES.TRACE_INGEST,
    async (job) => {
      const { traceId, tenantId, input, output, reasoning, source } = job.data;
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, traceId, tenantId }, 'Processing trace ingestion');

      try {
        workerState.activeJobs++;

        // Import required modules
        const { generateEmbedding, extractIntent, hashIntentTemplate } = await import('@substrate/ai');
        const { ids, generatePatternHash } = await import('@substrate/core');

        // Generate embedding and extract intent
        const embedding = await generateEmbedding(`${input} ${output}`);
        const intent = await extractIntent(input, output);
        const intentHash = hashIntentTemplate(intent.template);
        const patternHash = generatePatternHash(input, output);

        // Store the trace in the database
        const id = traceId || ids.trace();
        await query(
          `INSERT INTO reasoning_traces (
            id, input, reasoning, output, pattern_hash, embedding,
            intent_template, intent_category, intent_name, intent_parameters,
            tokens_used, execution_ms, source, owner_id, visibility, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
          ON CONFLICT (id) DO NOTHING`,
          [
            id,
            input,
            reasoning ?? null,
            output,
            patternHash,
            `[${embedding.join(',')}]`,
            intent.template,
            intent.category,
            intent.intentName,
            JSON.stringify(intent.parameters),
            job.data.tokensUsed ?? 0,
            Date.now() - start,
            source ?? 'worker',
            tenantId,
            'private',
          ]
        );

        const result = {
          processed: true,
          traceId: id,
          intentTemplate: intent.template,
          intentHash,
          patternHash,
        };

        workerState.jobsProcessed++;
        workerState.lastJobAt = new Date();

        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          traceId: id,
          intentTemplate: intent.template,
        }, 'Trace ingestion complete');

        return result;
      } catch (err) {
        workerState.jobsFailed++;
        logger.error({ jobId: job.id, workerId, traceId, error: err }, 'Trace ingestion failed');
        throw err;
      } finally {
        workerState.activeJobs--;
      }
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.trace,
      lockDuration: JOB_TIMEOUTS.trace,
      settings: {
        backoffStrategy: (attemptsMade) => {
          return Math.min(RETRY_CONFIG.trace.backoff.delay * Math.pow(2, attemptsMade), 30000);
        },
      },
    }
  );

  // ===========================================
  // Issue #2: Implement actual shard execution
  // ===========================================
  const executeWorker = new Worker(
    QUEUES.SHARD_EXECUTE,
    async (job) => {
      const { shardId, tenantId, input, context } = job.data;
      const start = Date.now();
      logger.info({ jobId: job.id, workerId, shardId, tenantId }, 'Processing shard execution');

      try {
        workerState.activeJobs++;

        // Import required modules
        const { procedural } = await import('@substrate/memory');
        const { execute: executeShard } = await import('@substrate/sandbox');

        // Get the shard
        const shard = await procedural.getShardById(shardId);
        if (!shard) {
          throw new Error(`Shard not found: ${shardId}`);
        }

        // Execute the shard
        const execResult = await executeShard(shard.logic, input);

        // Record the execution
        const tokensSaved = shard.estimatedTokens || 100;
        await procedural.recordExecution(
          shardId,
          execResult.success,
          execResult.executionMs,
          execResult.success ? tokensSaved : 0
        );

        const result = {
          executed: true,
          shardId,
          success: execResult.success,
          output: execResult.output,
          executionMs: execResult.executionMs,
          tokensSaved: execResult.success ? tokensSaved : 0,
          error: execResult.error,
        };

        workerState.jobsProcessed++;
        workerState.lastJobAt = new Date();

        logger.info({
          jobId: job.id,
          workerId,
          duration: Date.now() - start,
          shardId,
          success: execResult.success,
        }, 'Shard execution complete');

        return result;
      } catch (err) {
        workerState.jobsFailed++;
        logger.error({ jobId: job.id, workerId, shardId, error: err }, 'Shard execution failed');
        throw err;
      } finally {
        workerState.activeJobs--;
      }
    },
    {
      connection: redisConfig,
      concurrency: CONCURRENCY.execute,
      lockDuration: JOB_TIMEOUTS.execute,
      settings: {
        backoffStrategy: () => RETRY_CONFIG.execute.backoff.delay,
      },
    }
  );

  // Error handling for all workers
  const workers = [crystallizeWorker, promoteWorker, decayWorker, recalibrateWorker, challengeWorker, feedbackWorker, evolveWorker, classifierSeedWorker, metacogWorker, traceWorker, executeWorker];

  workers.forEach(worker => {
    worker.on('failed', (job, err) => {
      logger.error({
        jobId: job?.id,
        queue: worker.name,
        workerId,
        attempt: job?.attemptsMade,
        error: err.message
      }, 'Job failed');
    });

    worker.on('completed', (job) => {
      logger.debug({ jobId: job.id, queue: worker.name, workerId }, 'Job completed');
    });

    worker.on('stalled', (jobId) => {
      logger.warn({ jobId, queue: worker.name, workerId }, 'Job stalled');
    });
  });

  // ===========================================
  // Issue #7: Start health check server
  // ===========================================
  startWorkerHealthServer();

  // Handle shutdown gracefully
  const WORKER_SHUTDOWN_TIMEOUT = 10000; // 10 seconds
  process.on('SIGTERM', async () => {
    logger.info({ workerId }, 'Worker shutting down...');

    const forceExit = setTimeout(() => {
      logger.warn('Worker shutdown timed out, forcing exit');
      process.exit(1);
    }, WORKER_SHUTDOWN_TIMEOUT);

    try {
      // Close all workers
      await Promise.all(workers.map(w => w.close()));
      clearTimeout(forceExit);
      logger.info({ workerId }, 'Worker shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ error: err }, 'Error during worker shutdown');
      clearTimeout(forceExit);
      process.exit(1);
    }
  });

  logger.info({ workerId, queues: Object.values(QUEUES) }, 'Worker ready to process jobs');
}

// ===========================================
// Issue #7: Worker health check server
// ===========================================
function startWorkerHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const now = new Date();
      const uptimeMs = workerState.startedAt
        ? now.getTime() - workerState.startedAt.getTime()
        : 0;

      // Check if any circuit breakers are open
      const openCircuits = Object.entries(workerState.circuitBreakers)
        .filter(([, cb]) => cb.isOpen)
        .map(([name]) => name);

      // Worker is healthy if:
      // 1. DB and Redis connected
      // 2. No circuit breakers fully open (half-open is ok)
      // 3. Not stuck (lastJob within reasonable time or no jobs expected)
      const isHealthy = workerState.dbConnected &&
        workerState.redisConnected &&
        openCircuits.length === 0;

      const status = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        workerId,
        startedAt: workerState.startedAt?.toISOString() ?? null,
        uptimeMs,
        dbConnected: workerState.dbConnected,
        redisConnected: workerState.redisConnected,
        jobsProcessed: workerState.jobsProcessed,
        jobsFailed: workerState.jobsFailed,
        activeJobs: workerState.activeJobs,
        lastJobAt: workerState.lastJobAt?.toISOString() ?? null,
        openCircuits,
        circuitBreakers: Object.fromEntries(
          Object.entries(workerState.circuitBreakers).map(([name, cb]) => [
            name,
            { failures: cb.failures, isOpen: cb.isOpen },
          ])
        ),
        config: {
          concurrency: CONCURRENCY,
          rateLimits: RATE_LIMITS,
          timeouts: JOB_TIMEOUTS,
        },
      };

      res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(healthPort, '0.0.0.0', () => {
    logger.info({ port: healthPort }, 'Worker health check server started');
  });
}

// ============================================
// MAIN ENTRY POINT
// ============================================
async function start() {
  // Initialize database
  initializePool({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://substrate:substrate_dev@localhost:5432/substrate',
  });

  // Initialize AI
  initializeAI({
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    openaiApiKey: process.env['OPENAI_API_KEY'],
  });

  // Initialize event bus
  initializeEventBus({ redisUrl });

  // Run as scheduler or worker based on WORKER_ROLE env
  if (isScheduler) {
    await runScheduler();
  } else {
    await runWorker();
  }
}

start().catch((err) => {
  logger.error({
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  }, 'Worker failed to start');
  process.exit(1);
});

// ============================================
// EXPORTED QUEUE HELPERS (for API to enqueue jobs)
// Issue #5: Reuse queue instances to prevent connection churn
// ============================================

// Singleton queue instances (lazy initialization)
let traceQueue: Queue | null = null;
let executeQueue: Queue | null = null;

function getTraceQueue(): Queue {
  if (!traceQueue) {
    traceQueue = new Queue(QUEUES.TRACE_INGEST, { connection: redisConfig });
  }
  return traceQueue;
}

function getExecuteQueue(): Queue {
  if (!executeQueue) {
    executeQueue = new Queue(QUEUES.SHARD_EXECUTE, { connection: redisConfig });
  }
  return executeQueue;
}

export async function enqueueTraceIngestion(data: {
  traceId?: string;
  tenantId: string;
  input: string;
  output: string;
  reasoning?: string;
  source?: string;
  tokensUsed?: number;
}) {
  const queue = getTraceQueue();
  const job = await queue.add('ingest', data, {
    removeOnComplete: 1000,
    removeOnFail: 500,
    attempts: RETRY_CONFIG.trace.attempts,
    backoff: RETRY_CONFIG.trace.backoff,
  });
  return job;
}

export async function enqueueShardExecution(data: {
  shardId: string;
  tenantId: string;
  input: string;
  context?: Record<string, unknown>;
}) {
  const queue = getExecuteQueue();
  const job = await queue.add('execute', data, {
    removeOnComplete: 1000,
    removeOnFail: 500,
    attempts: RETRY_CONFIG.execute.attempts,
    backoff: RETRY_CONFIG.execute.backoff,
  });
  return job;
}

// Cleanup function for graceful shutdown
export async function closeQueues(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  if (traceQueue) closePromises.push(traceQueue.close());
  if (executeQueue) closePromises.push(executeQueue.close());
  await Promise.all(closePromises);
  traceQueue = null;
  executeQueue = null;
}

export { QUEUES };
