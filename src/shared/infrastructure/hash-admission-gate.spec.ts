import { HashAdmissionGate } from './hash-admission-gate.js';

describe('HashAdmissionGate', () => {
  it('caps concurrency and sheds load beyond the queue', async () => {
    const gate = new HashAdmissionGate(2, 1);
    let peak = 0;
    const work = async () => {
      peak = Math.max(peak, gate.stats.running);
      await new Promise((r) => setTimeout(r, 10));
      return 'done';
    };

    const results = await Promise.all([
      gate.run(work),
      gate.run(work),
      gate.run(work),
      gate.run(work),
    ]);

    expect(peak).toBe(2);
    expect(results.filter((r) => r === undefined)).toHaveLength(1);
  });
});
