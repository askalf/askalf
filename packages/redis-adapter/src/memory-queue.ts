/**
 * In-Memory Job Queue
 *
 * Replaces BullMQ for standalone mode. Implements the subset of the BullMQ API
 * used by ForgeScheduler: add(), Worker with process callback, retry with backoff.
 *
 * No persistence — jobs live in memory only. This is fine because:
 * - Workflow runs are already tracked in the database
 * - Orphan recovery on restart already exists in the scheduler
 * - Standalone mode is single-user, single-process
 */

import { EventEmitter } from 'node:events';

export type JobData = Record<string, unknown>;

export interface JobOpts {
  delay?: number;
  attempts?: number;
  backoff?: { type: string; delay: number };
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
}

export interface Job<T = JobData> {
  id: string;
  name: string;
  data: T;
  opts: JobOpts;
  attemptsMade: number;
  timestamp: number;
}

type ProcessorFn<T = JobData> = (job: Job<T>) => Promise<unknown>;

export class InMemoryQueue<T extends JobData = JobData> extends EventEmitter {
  readonly name: string;
  private jobs: Job<T>[] = [];
  private idCounter = 0;

  constructor(name: string) {
    super();
    this.name = name;
  }

  async add(name: string, data: T, opts?: JobOpts): Promise<Job<T>> {
    const job: Job<T> = {
      id: String(++this.idCounter),
      name,
      data,
      opts: opts ?? {},
      attemptsMade: 0,
      timestamp: Date.now(),
    };

    if (opts?.delay) {
      setTimeout(() => {
        this.jobs.push(job);
        this.emit('waiting', job);
      }, opts.delay);
    } else {
      this.jobs.push(job);
      this.emit('waiting', job);
    }

    return job;
  }

  async getJobs(states: string[]): Promise<Job<T>[]> {
    return [...this.jobs];
  }

  async obliterate(): Promise<void> {
    this.jobs = [];
  }

  async close(): Promise<void> {
    this.jobs = [];
    this.removeAllListeners();
  }
}

export class InMemoryWorker<T extends JobData = JobData> extends EventEmitter {
  private running = true;
  private processing = false;
  private queue: InMemoryQueue<T>;
  private processor: ProcessorFn<T>;
  private concurrency: number;
  private activeCount = 0;

  constructor(
    _name: string,
    processor: ProcessorFn<T>,
    opts?: { concurrency?: number; connection?: unknown },
  ) {
    super();
    this.processor = processor;
    this.concurrency = opts?.concurrency ?? 1;

    // Create a paired queue reference
    this.queue = new InMemoryQueue<T>(_name);
  }

  /** Attach to an existing queue to process its jobs. */
  attachQueue(queue: InMemoryQueue<T>): void {
    this.queue = queue;
    queue.on('waiting', () => this.tryProcess());
  }

  private async tryProcess(): Promise<void> {
    if (!this.running || this.processing || this.activeCount >= this.concurrency) return;

    const jobs = await this.queue.getJobs(['waiting']);
    if (jobs.length === 0) return;

    const job = jobs.shift()!;
    this.activeCount++;
    this.processing = true;

    try {
      const result = await this.processor(job);
      job.attemptsMade++;
      this.emit('completed', job, result);
    } catch (err) {
      job.attemptsMade++;
      const maxAttempts = job.opts.attempts ?? 1;

      if (job.attemptsMade < maxAttempts) {
        const backoffDelay = job.opts.backoff?.delay ?? 1000;
        const delay = backoffDelay * Math.pow(2, job.attemptsMade - 1);
        setTimeout(() => {
          this.queue.add(job.name, job.data, { ...job.opts, delay: 0 });
        }, delay);
      } else {
        this.emit('failed', job, err);
      }
    } finally {
      this.activeCount--;
      this.processing = false;
      // Process next job
      setImmediate(() => this.tryProcess());
    }
  }

  async close(): Promise<void> {
    this.running = false;
    this.removeAllListeners();
  }
}
