export { RunpodOrchestratorImpl as RunpodOrchestrator } from "./orchestrator";
export * from "./types";
export * from "./constants";
export * from "./dispatcher";

import { RunpodOrchestratorImpl } from "./orchestrator";
import { CentralDispatcher } from "./dispatcher";
import { RunpodOrchestratorConfig } from "./types";
import { Redis } from "ioredis";

// Map of Redis connection strings to dispatcher instances
const dispatchers: Map<string, CentralDispatcher<any>> = new Map();

function getRedisKey(redis: Redis): string {
  // Create a unique key based on Redis connection details
  const options = redis.options || {};
  const host = options.host || "localhost";
  const port = options.port || 6379;
  const db = options.db || 0;
  return `${host}:${port}:${db}`;
}

export async function createOrchestrator<TMetadata = Record<string, any>>(
  config: RunpodOrchestratorConfig
): Promise<RunpodOrchestratorImpl<TMetadata>> {
  // Create Redis instance
  const redisInstance =
    "client" in config.redis
      ? config.redis.client
      : new Redis(config.redis.url || "redis://localhost:6379");

  // Get or create dispatcher for this Redis instance
  const redisKey = getRedisKey(redisInstance);
  let dispatcher = dispatchers.get(redisKey);

  if (!dispatcher) {
    dispatcher = new CentralDispatcher<TMetadata>(redisInstance, config);
    await dispatcher.start();
    dispatchers.set(redisKey, dispatcher);
  }

  const orchestrator = new RunpodOrchestratorImpl<TMetadata>(config, dispatcher);
  await orchestrator.start();
  return orchestrator;
}

export async function getGlobalDispatcher(): Promise<CentralDispatcher<any> | null> {
  // Return the first dispatcher for backward compatibility
  return dispatchers.values().next().value || null;
}

export async function getAllDispatchers(): Promise<CentralDispatcher<any>[]> {
  return Array.from(dispatchers.values());
}

export async function stopAllDispatchers(): Promise<void> {
  const stopPromises = Array.from(dispatchers.values()).map((dispatcher) =>
    dispatcher.stop()
  );
  await Promise.all(stopPromises);
  dispatchers.clear();
}

// Backward compatibility
export async function stopGlobalDispatcher(): Promise<void> {
  await stopAllDispatchers();
}
