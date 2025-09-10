export { RunpodOrchestratorImpl as RunpodOrchestrator } from './orchestrator';
export * from './types';
export * from './constants';
export * from './dispatcher';

import { RunpodOrchestratorImpl } from './orchestrator';
import { CentralDispatcher } from './dispatcher';
import { RunpodOrchestratorConfig } from './types';
import { Redis } from 'ioredis';

// Global dispatcher instance
let globalDispatcher: CentralDispatcher | null = null;

export async function createOrchestrator(
  config: RunpodOrchestratorConfig,
  redis?: Redis
): Promise<RunpodOrchestratorImpl> {
  // Create or get global dispatcher
  if (!globalDispatcher) {
    const redisInstance = redis || new (require('ioredis'))(
      'url' in config.redis ? config.redis.url || 'redis://localhost:6379' : 'redis://localhost:6379'
    );
    globalDispatcher = new CentralDispatcher(redisInstance, config);
    await globalDispatcher.start();
  }

  const orchestrator = new RunpodOrchestratorImpl(config, globalDispatcher);
  await orchestrator.start();
  return orchestrator;
}

export async function getGlobalDispatcher(): Promise<CentralDispatcher | null> {
  return globalDispatcher;
}

export async function stopGlobalDispatcher(): Promise<void> {
  if (globalDispatcher) {
    await globalDispatcher.stop();
    globalDispatcher = null;
  }
}
