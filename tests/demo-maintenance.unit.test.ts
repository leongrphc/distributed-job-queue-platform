import { describe, expect, it, vi } from 'vitest';

vi.mock('../apps/api/src/config.js', () => ({ config: { DEMO_RETENTION_HOURS: 24 } }));
vi.mock('../apps/api/src/db.js', () => ({ db: {} }));

import { runDemoMaintenance } from '../apps/api/src/demo-maintenance.js';

const row = { id: 'job-1' };
function database(rows = [row as typeof row]) {
  return { job: { findMany: vi.fn().mockResolvedValue(rows), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } } as any;
}
function queue(job?: any) { return { getJob: vi.fn().mockResolvedValue(job) } as any; }

describe('demo maintenance', () => {
  it('selects only old terminal jobs with a bounded batch', async () => {
    const databaseMock = database([]);
    await runDemoMaintenance({ database: databaseMock, jobs: queue(), dead: queue(), now: () => new Date('2026-01-02T00:00:00Z') });
    expect(databaseMock.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100, where: expect.objectContaining({ status: { in: ['succeeded', 'failed', 'cancelled'] }, finishedAt: { lt: new Date('2026-01-01T00:00:00Z') } }) }));
  });

  it('skips active Redis jobs', async () => {
    const databaseMock = database();
    const active = { getState: vi.fn().mockResolvedValue('active'), remove: vi.fn() };
    await runDemoMaintenance({ database: databaseMock, jobs: queue(active), dead: queue(), now: () => new Date('2026-01-02T00:00:00Z') });
    expect(databaseMock.job.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the database row when Redis removal fails', async () => {
    const databaseMock = database();
    const redisJob = { getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn().mockRejectedValue(new Error('locked')) };
    await runDemoMaintenance({ database: databaseMock, jobs: queue(redisJob), dead: queue(), now: () => new Date('2026-01-02T00:00:00Z') });
    expect(databaseMock.job.deleteMany).not.toHaveBeenCalled();
  });

  it('removes both queue records before deleting the database row', async () => {
    const databaseMock = database();
    const jobsJob = { getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn().mockResolvedValue(undefined) };
    const deadJob = { getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn().mockResolvedValue(undefined) };
    await runDemoMaintenance({ database: databaseMock, jobs: queue(jobsJob), dead: queue(deadJob), now: () => new Date('2026-01-02T00:00:00Z') });
    expect(jobsJob.remove).toHaveBeenCalled();
    expect(deadJob.remove).toHaveBeenCalled();
    expect(databaseMock.job.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: row.id, finishedAt: expect.any(Object) }) }));
  });
});
