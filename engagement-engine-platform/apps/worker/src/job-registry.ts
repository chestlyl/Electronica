export interface Job {
  name: string;
  description: string;
  run(): Promise<void>;
}

export class JobRegistry {
  private jobs = new Map<string, Job>();

  register(job: Job): void {
    this.jobs.set(job.name, job);
    console.log(`[worker] registered job: ${job.name}`);
  }

  async run(name: string): Promise<void> {
    const job = this.jobs.get(name);

    if (!job) {
      throw new Error(`Job not found: ${name}`);
    }

    console.log(`[worker] running job: ${name}`);
    const start = Date.now();
    await job.run();
    console.log(`[worker] job complete: ${name} (${Date.now() - start}ms)`);
  }

  list(): string[] {
    return Array.from(this.jobs.keys());
  }
}

export const registry = new JobRegistry();
