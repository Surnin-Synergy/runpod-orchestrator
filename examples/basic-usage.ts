import { config } from "dotenv";
import { createOrchestrator, stopGlobalDispatcher } from "../src/index";
import { RunpodOrchestratorImpl } from "../src/orchestrator";

// Define custom metadata and output types
interface CustomMetadata {
  userId: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  source: string;
}

interface CustomOutput {
  result: string;
  confidence: number;
  processingTime: number;
  model: string;
}

// Load environment variables from .env file
config();

const ENDPOINT_ID_1 = "" // any other endpoint id;
const ENDPOINT_ID_2 = process.env.RUNPOD_ENDPOINT_ID || "black-forest-labs-flux-1-schnell";

// Example function demonstrating generic metadata and output usage
async function demonstrateGenericTyping() {
  console.log("🔧 Demonstrating generic metadata and output typing...");
  
  // Create orchestrator with typed metadata and output
  const orchestrator = await createOrchestrator<CustomMetadata, CustomOutput>({
    redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
    runpod: {
      apiKey: process.env.RUNPOD_API_KEY!,
      endpointId: process.env.RUNPOD_ENDPOINT_ID || "test-endpoint",
    },
    polling: {
      initialBackoffMs: 2000,
      maxBackoffMs: 10000,
    },
    storage: {
      persistInput: true,
      resultTtlSec: 3600,
    },
  });

  // Set up event listeners with typed metadata
  orchestrator.on('submitted', (payload) => {
    console.log('Job submitted:', payload.clientJobId);
    // TypeScript now knows payload.metadata is of type CustomMetadata (required)
    console.log('User ID:', payload.metadata.userId);
    console.log('Priority:', payload.metadata.priority);
    console.log('Tags:', payload.metadata.tags);
  });

  orchestrator.on('progress', (payload) => {
    console.log('Job progress:', payload.clientJobId, 'status:', payload.status);
    // TypeScript now knows payload.metadata is of type CustomMetadata (required)
    console.log('User ID:', payload.metadata.userId);
    // TypeScript now knows payload.runpodStatus is of type RunpodStatus | undefined
    if (payload.runpodStatus) {
      console.log('RunPod job ID:', payload.runpodStatus.id);
      console.log('Current status:', payload.runpodStatus.status);
      console.log('Worker ID:', payload.runpodStatus.workerId);
    }
  });

  orchestrator.on('completed', (payload) => {
    console.log('Job completed:', payload.clientJobId);
    // TypeScript now knows payload.metadata is of type CustomMetadata (required)
    console.log('Completed job for user:', payload.metadata.userId);
    // TypeScript now knows payload.output is of type CustomOutput | undefined
    if (payload.output) {
      console.log('Result:', payload.output.result);
      console.log('Confidence:', payload.output.confidence);
      console.log('Processing time:', payload.output.processingTime);
      console.log('Model used:', payload.output.model);
    }
    // TypeScript now knows payload.runpodStatus is of type RunpodStatus | undefined
    if (payload.runpodStatus) {
      console.log('RunPod job ID:', payload.runpodStatus.id);
      console.log('Delay time:', payload.runpodStatus.delayTime, 'ms');
      console.log('Execution time:', payload.runpodStatus.executionTime, 'ms');
      console.log('Worker ID:', payload.runpodStatus.workerId);
    }
  });

  // Submit job with typed metadata
  const jobResult = await orchestrator.submit({
    clientJobId: 'typed-job-1',
    input: { prompt: 'Hello world' },
    metadata: {
      userId: 'user-123',
      priority: 'high',
      tags: ['urgent', 'demo'],
      source: 'api'
    } // TypeScript will enforce this structure
  });

  console.log('Job submitted with typed metadata:', jobResult);

  // Get job with typed metadata and output
  const job = await orchestrator.get('typed-job-1');
  if (job) {
    // TypeScript knows job.metadata is of type CustomMetadata (required)
    console.log('Retrieved job metadata:', job.metadata);
    console.log('User priority:', job.metadata.priority);
  }
  if (job && job.output) {
    // TypeScript knows job.output is of type CustomOutput | undefined
    console.log('Retrieved job output:', job.output);
    console.log('Result confidence:', job.output.confidence);
  }
  if (job && job.runpodStatus) {
    // TypeScript knows job.runpodStatus is of type RunpodStatus | undefined
    console.log('Retrieved job RunPod status:', job.runpodStatus);
    console.log('RunPod job ID:', job.runpodStatus.id);
    console.log('Execution time:', job.runpodStatus.executionTime, 'ms');
  }

  await orchestrator.close();
}

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

  orchestrator1.on("progress", ({ clientJobId, status, runpodStatus, metadata }) => {
    console.log(`🔄 [Orchestrator1] Job ${clientJobId} status: ${status}`, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
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

  orchestrator2.on("progress", ({ clientJobId, status, runpodStatus, metadata }) => {
    console.log(`🔄 [Orchestrator2] Job ${clientJobId} status: ${status}`, metadata ? `(metadata: ${JSON.stringify(metadata)})` : '');
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
    // Demonstrate generic metadata and output usage
    console.log("\n--- Demonstrating Generic Typing ---");
    await demonstrateGenericTyping();

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
