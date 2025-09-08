import { createOrchestrator } from "../src/index";

// This example demonstrates running multiple instances of the orchestrator
// Each instance will process jobs independently but coordinate through Redis

async function createInstance(instanceId: string, port: number) {
  console.log(`🚀 Starting instance ${instanceId} on port ${port}`);

  const orchestrator = await createOrchestrator({
    instanceId,
    redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
    runpod: {
      apiKey: process.env.RUNPOD_API_KEY!,
      endpointId: process.env.RUNPOD_ENDPOINT_ID!,
    },
    polling: {
      batchSize: 10, // Smaller batch size for demo
    },
    storage: {
      persistInput: true,
      resultTtlSec: 604800, // 7 days
    },
    logging: {
      info: (msg, ...args) => console.log(`[${instanceId}] ${msg}`, ...args),
      error: (msg, ...args) =>
        console.error(`[${instanceId}] ERROR: ${msg}`, ...args),
    },
  });

  // Set up event listeners
  orchestrator.on("submitted", ({ clientJobId, runpodJobId }) => {
    console.log(
      `[${instanceId}] ✅ Submitted ${clientJobId} -> ${runpodJobId}`
    );
  });

  orchestrator.on("completed", ({ clientJobId, output }) => {
    console.log(`[${instanceId}] 🎉 Completed ${clientJobId}`);
  });

  orchestrator.on("failed", ({ clientJobId, error, status }) => {
    console.log(
      `[${instanceId}] ❌ Failed ${clientJobId} (${status}): ${error}`
    );
  });

  // Recover any pending jobs on startup
  const recovered = await orchestrator.recoverAllPending();
  console.log(`[${instanceId}] Recovered ${recovered} pending jobs`);

  return orchestrator;
}

async function simulateWorkload(instanceId: string, orchestrator: any) {
  // Simulate submitting jobs at random intervals
  const submitJob = async (jobNumber: number) => {
    const clientJobId = `${instanceId}-job-${jobNumber}`;

    try {
      await orchestrator.submit({
        clientJobId,
        input: {
          prompt: `Job ${jobNumber} from ${instanceId}`,
          instanceId,
          timestamp: Date.now(),
        },
      });

      console.log(`[${instanceId}] 📤 Submitted job ${jobNumber}`);
    } catch (error) {
      console.error(
        `[${instanceId}] Failed to submit job ${jobNumber}:`,
        error
      );
    }
  };

  // Submit jobs at random intervals
  const submitInterval = setInterval(() => {
    const jobNumber = Math.floor(Math.random() * 1000);
    submitJob(jobNumber);
  }, Math.random() * 5000 + 2000); // 2-7 seconds

  // Stop submitting after 30 seconds
  setTimeout(() => {
    clearInterval(submitInterval);
    console.log(`[${instanceId}] Stopped submitting new jobs`);
  }, 30000);

  return submitInterval;
}

async function main() {
  const numInstances = parseInt(process.env.NUM_INSTANCES || "3");
  const instances: any[] = [];
  const intervals: NodeJS.Timeout[] = [];

  console.log(`🏗️  Starting ${numInstances} orchestrator instances...`);

  try {
    // Create multiple instances
    for (let i = 0; i < numInstances; i++) {
      const instanceId = `instance-${i + 1}`;
      const orchestrator = await createInstance(instanceId, 3000 + i);
      instances.push(orchestrator);

      // Start workload simulation
      const interval = await simulateWorkload(instanceId, orchestrator);
      intervals.push(interval);

      // Add some delay between instance starts
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`✅ All ${numInstances} instances started successfully`);
    console.log("📊 Monitor Redis to see distributed coordination in action");
    console.log("⏹️  Press Ctrl+C to stop all instances");

    // Keep running until interrupted
    await new Promise(() => {});
  } catch (error) {
    console.error("Error in main:", error);
  } finally {
    // Cleanup
    console.log("\n🧹 Cleaning up...");

    // Clear intervals
    intervals.forEach((interval) => clearInterval(interval));

    // Close all orchestrators
    await Promise.all(instances.map((instance) => instance.close()));

    console.log("✅ All instances closed");
  }
}

// Handle graceful shutdown
let isShuttingDown = false;

process.on("SIGINT", async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Run the example
if (require.main === module) {
  main().catch(console.error);
}
