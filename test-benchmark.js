import { performance } from 'perf_hooks';

function runBenchmark() {
  const NO_FLOOR = Number.MIN_SAFE_INTEGER;
  const NO_CEILING = Number.MAX_SAFE_INTEGER;

  const displayPack = {
    accounts: Array.from({ length: 50 }, (_, i) => ({
      id: `acc-${i}`,
      label: `Account ${i}`,
      minBalance: NO_FLOOR,
      maxBalance: NO_CEILING,
      color: null,
      enabled: true,
    }))
  };

  const pack = {
    accounts: Array.from({ length: 50 }, (_, i) => ({
      id: `acc-${i}`,
      label: `Account ${i}`,
      minBalance: NO_FLOOR,
      maxBalance: NO_CEILING,
      color: null,
      enabled: true,
    }))
  };

  const workingPack = {
    accounts: Array.from({ length: 50 }, (_, i) => ({
      id: `acc-${i}`,
      label: `Account ${i}`,
      minBalance: NO_FLOOR,
      maxBalance: NO_CEILING,
      color: null,
      enabled: true,
    }))
  };
  // modify one account to make it different
  workingPack.accounts[49].label = "Modified Account 49";

  const isDirty = true;

  let totalTimeOld = 0;

  const iterations = 1000;

  const startOld = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (const a of displayPack.accounts) {
      const changed = isDirty && workingPack?.accounts.some(
        (wa) => wa.id === a.id && JSON.stringify(wa) !== JSON.stringify(pack.accounts.find((pa) => pa.id === a.id))
      );
    }
  }
  const endOld = performance.now();
  totalTimeOld = endOld - startOld;

  console.log(`Old approach: ${totalTimeOld.toFixed(2)}ms`);

  // New approach
  const startNew = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Determine changed map separately once
    const changedMap = new Set();
    if (isDirty && workingPack) {
      for (const wa of workingPack.accounts) {
        const pa = pack.accounts.find(p => p.id === wa.id);
        if (pa) {
          // simple shallow comparison or check properties
          if (
            wa.label !== pa.label ||
            wa.minBalance !== pa.minBalance ||
            wa.maxBalance !== pa.maxBalance ||
            wa.color !== pa.color ||
            wa.enabled !== pa.enabled
          ) {
            changedMap.add(wa.id);
          }
        } else {
            changedMap.add(wa.id); // New account
        }
      }
    }

    for (const a of displayPack.accounts) {
      const changed = changedMap.has(a.id);
    }
  }
  const endNew = performance.now();
  const totalTimeNew = endNew - startNew;

  console.log(`New approach: ${totalTimeNew.toFixed(2)}ms`);
  console.log(`Improvement: ${(totalTimeOld / totalTimeNew).toFixed(2)}x faster`);
}

runBenchmark();
