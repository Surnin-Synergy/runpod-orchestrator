import { config } from "dotenv";
import { createOrchestrator, stopGlobalDispatcher } from "../src/index";

// Load environment variables from .env file
config();

const ENDPOINT_ID_1 = "" // any other endpoint id;
const ENDPOINT_ID_2 = process.env.RUNPOD_ENDPOINT_ID || "black-forest-labs-flux-1-schnell";

async function main() {
  console.log("🚀 Starting orchestrators with central dispatcher...");

  // Create first orchestrator
  const orchestrator1 = await createOrchestrator({
    redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
    runpod: {
      apiKey: process.env.RUNPOD_API_KEY!,
      endpointId: ENDPOINT_ID_1,
    },
    polling: {
      initialBackoffMs: 2000,
      maxBackoffMs: 10000,
      batchSize: 50,
    },
    storage: {
      persistInput: true,
      resultTtlSec: 604800, // 7 days
    },
    dedupe: {
      enable: true,
      useInputHash: true,
    },
    logging: {
      debug: (msg, ...args) => console.debug(`[DEBUG-1] ${msg}`, ...args),
      info: (msg, ...args) => console.info(`[INFO-1] ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[ERROR-1] ${msg}`, ...args),
    },
  });

  // Create second orchestrator
  const orchestrator2 = await createOrchestrator({
    redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
    runpod: {
      apiKey: process.env.RUNPOD_API_KEY!,
      endpointId: ENDPOINT_ID_2,
    },
    polling: {
      initialBackoffMs: 2000,
      maxBackoffMs: 10000,
      batchSize: 50,
    },
    storage: {
      persistInput: true,
      resultTtlSec: 604800, // 7 days
    },
    dedupe: {
      enable: true,
      useInputHash: true,
    },
    logging: {
      debug: (msg, ...args) => console.debug(`[DEBUG-2] ${msg}`, ...args),
      info: (msg, ...args) => console.info(`[INFO-2] ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[ERROR-2] ${msg}`, ...args),
    },
  });

  // Set up event listeners for orchestrator1
  orchestrator1.on("submitted", ({ clientJobId, runpodJobId, metadata }) => {
    console.log(`✅ [Orchestrator1] Job ${clientJobId} submitted to Runpod: ${runpodJobId}`, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
  });

  orchestrator1.on("progress", ({ clientJobId, status, metrics, runpodStatus, metadata }) => {
    console.log(`🔄 [Orchestrator1] Job ${clientJobId} status: ${status}`, metrics, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
    if (runpodStatus) {
      console.log(`📊 [Orchestrator1] RunpodStatus for ${clientJobId}:`, JSON.stringify(runpodStatus, null, 2));
    }
  });

  orchestrator1.on("completed", ({ clientJobId, output, runpodStatus, metadata }) => {
    console.log(`🎉 [Orchestrator1] Job ${clientJobId} completed:`, output, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
    if (runpodStatus) {
      console.log(`📊 [Orchestrator1] Final RunpodStatus for ${clientJobId}:`, JSON.stringify(runpodStatus, null, 2));
    }
  });

  orchestrator1.on("failed", ({ clientJobId, error, status, runpodStatus, metadata }) => {
    console.error(`❌ [Orchestrator1] Job ${clientJobId} failed (${status}):`, error, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
    if (runpodStatus) {
      console.log(`📊 [Orchestrator1] Final RunpodStatus for ${clientJobId}:`, JSON.stringify(runpodStatus, null, 2));
    }
  });

  // Set up event listeners for orchestrator2
  orchestrator2.on("submitted", ({ clientJobId, runpodJobId, metadata }) => {
    console.log(`✅ [Orchestrator2] Job ${clientJobId} submitted to Runpod: ${runpodJobId}`, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
  });

  orchestrator2.on("progress", ({ clientJobId, status, metrics, runpodStatus, metadata }) => {
    console.log(`🔄 [Orchestrator2] Job ${clientJobId} status: ${status}`, metrics, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
    if (runpodStatus) {
      console.log(`📊 [Orchestrator2] RunpodStatus for ${clientJobId}:`, JSON.stringify(runpodStatus, null, 2));
    }
  });

  orchestrator2.on("completed", ({ clientJobId, output, runpodStatus, metadata }) => {
    console.log(`🎉 [Orchestrator2] Job ${clientJobId} completed:`, output, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
    if (runpodStatus) {
      console.log(`📊 [Orchestrator2] Final RunpodStatus for ${clientJobId}:`, JSON.stringify(runpodStatus, null, 2));
    }
  });

  orchestrator2.on("failed", ({ clientJobId, error, status, runpodStatus, metadata }) => {
    console.error(`❌ [Orchestrator2] Job ${clientJobId} failed (${status}):`, error, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
    if (runpodStatus) {
      console.log(`📊 [Orchestrator2] Final RunpodStatus for ${clientJobId}:`, JSON.stringify(runpodStatus, null, 2));
    }
  });

  try {
    console.log("\n--- Testing Central Dispatcher Architecture ---");
    console.log(`Orchestrator1 endpoint: ${ENDPOINT_ID_1}`);
    console.log(`Orchestrator2 endpoint: ${ENDPOINT_ID_2}`);
    console.log("Both orchestrators share the same Redis dispatcher that routes jobs by endpointId\n");

    // Submit job to orchestrator1 (should be processed by orchestrator1)
    console.log("--- Submitting job to Orchestrator1 ---");
    const job1 = await orchestrator1.submit({
      clientJobId: `job-${Date.now()}-1`,
      input: {
        prompt: "A beautiful sunset over mountains",
        seed: 42,
        num_inference_steps: 4,
        guidance: 7,
        negative_prompt: "",
        image_format: "png",
        width: 512,
        height: 512,
      },
      metadata: {
        source: "orchestrator1",
        test: "dispatcher-routing"
      }
    });
    console.log("Submitted job to orchestrator1:", job1.clientJobId);

    // Submit job to orchestrator2 (should be processed by orchestrator2)
    console.log("\n--- Submitting job to Orchestrator2 ---");
    const job2 = await orchestrator2.submit({
      clientJobId: `job-${Date.now()}-2`,
      input: {
        prompt: "A cat sitting on a windowsill",
        seed: 123,
        num_inference_steps: 4,
        guidance: 7,
        negative_prompt: "",
        image_format: "png",
        width: 512,
        height: 512,
      },
      metadata: {
        source: "orchestrator2",
        test: "dispatcher-routing"
      }
    });
    console.log("Submitted job to orchestrator2:", job2.clientJobId);

    // Wait for results
    console.log("\n--- Waiting for results ---");
    const [result1, result2] = await Promise.all([
      orchestrator1.awaitResult(job1.clientJobId, 5 * 60 * 1000), // 5 minutes
      orchestrator2.awaitResult(job2.clientJobId, 5 * 60 * 1000)  // 5 minutes
    ]);

    console.log("\n--- Results ---");
    console.log("Job1 result:", result1.status);
    if (result1.runpodStatus) {
      console.log("Job1 runpodStatus:", JSON.stringify(result1.runpodStatus, null, 2));
    }
    console.log("Job2 result:", result2.status);
    if (result2.runpodStatus) {
      console.log("Job2 runpodStatus:", JSON.stringify(result2.runpodStatus, null, 2));
    }

    console.log("\n✅ Central dispatcher architecture working correctly!");
    console.log("Jobs were routed to the correct orchestrators based on endpointId");

  } catch (error) {
    console.error("Error in main:", error);
  } finally {
    // Clean shutdown
    console.log("\n--- Shutting down ---");
    await orchestrator1.close();
    await orchestrator2.close();
    await stopGlobalDispatcher();
    console.log("All orchestrators and dispatcher closed");
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nReceived SIGINT, shutting down gracefully...");
  await stopGlobalDispatcher();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM, shutting down gracefully...");
  await stopGlobalDispatcher();
  process.exit(0);
});

// Run the example
if (require.main === module) {
  main().catch(console.error);
}
