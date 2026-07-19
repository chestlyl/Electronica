import { describe, expect, it } from 'vitest';
import { JobRegistry } from '../job-registry.js';

describe('JobRegistry', () => {
  it('registers and lists jobs', () => {
    const reg = new JobRegistry();
    reg.register({ name: 'test-job', description: 'test', run: async () => {} });
    expect(reg.list()).toContain('test-job');
  });

  it('runs a registered job', async () => {
    const reg = new JobRegistry();
    let ran = false;

    reg.register({
      name: 'run-me',
      description: 'test',
      run: async () => {
        ran = true;
      },
    });

    await reg.run('run-me');
    expect(ran).toBe(true);
  });

  it('throws for unknown job', async () => {
    const reg = new JobRegistry();
    await expect(reg.run('no-such-job')).rejects.toThrow('Job not found: no-such-job');
  });
});
