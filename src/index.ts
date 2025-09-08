export { RunpodOrchestratorImpl as RunpodOrchestrator } from './orchestrator';
export * from './types';
export * from './constants';

import { RunpodOrchestratorImpl } from './orchestrator';
import { RunpodOrchestratorConfig } from './types';

export async function createOrchestrator(config: RunpodOrchestratorConfig): Promise<RunpodOrchestratorImpl> {
  const orchestrator = new RunpodOrchestratorImpl(config);
  await orchestrator.start();
  return orchestrator;
}
