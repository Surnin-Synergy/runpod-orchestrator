import { config } from "dotenv";
import { createOrchestrator } from "../src/index";

// Load environment variables from .env file
config();

const ENDPOINT_ID =
  process.env.RUNPOD_ENDPOINT_ID || "black-forest-labs-flux-1-schnell";

async function main() {
  // Create orchestrator instance
  const orchestrator = await createOrchestrator({
    redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
    runpod: {
      apiKey: process.env.RUNPOD_API_KEY!,
      endpointId: ENDPOINT_ID,
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
      debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
      info: (msg, ...args) => console.info(`[INFO] ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    },
  });

  // Set up event listeners
  orchestrator.on("submitted", ({ clientJobId, runpodJobId }) => {
    console.log(`✅ Job ${clientJobId} submitted to Runpod: ${runpodJobId}`);
  });

  orchestrator.on("progress", ({ clientJobId, status, metrics }) => {
    console.log(`🔄 Job ${clientJobId} status: ${status}`, metrics);
  });

  orchestrator.on("completed", ({ clientJobId, output }) => {
    console.log(`🎉 Job ${clientJobId} completed:`, output);
  });

  orchestrator.on("failed", ({ clientJobId, error, status }) => {
    console.error(`❌ Job ${clientJobId} failed (${status}):`, error);
  });

  try {
    // Example 1: Simple job submission
    console.log("\n--- Example 1: Simple Job Submission ---");
    const job1 = await orchestrator.submit({
      clientJobId: `job-${Date.now()}-1`,
      input: {
        prompt:
          "A lone snowboarder carving down an untouched powder slope; the trail behind them disintegrates into cascading pixel voxels of cyan, magenta, and gold, alpine sky crystal-clear, hi-key lighting, large negative space, ultra-sharp 8-k",
        seed: -1,
        num_inference_steps: 4,
        guidance: 7,
        negative_prompt: "",
        image_format: "png",
        width: 1024,
        height: 1024,
      },
    });
    console.log("Submitted job:", job1.clientJobId);

    // Wait for result
    const result1 = await orchestrator.awaitResult(
      job1.clientJobId,
      5 * 60 * 1000
    ); // 5 minutes
    console.log("Job 1 result:", result1);

    // Example 2: Job with input hash for deduplication
    console.log("\n--- Example 2: Job with Deduplication ---");
    const input2 = { prompt: "Same prompt for deduplication test" };
    const inputHash2 = `sha256:${Buffer.from(JSON.stringify(input2)).toString(
      "base64"
    )}`;

    const job2a = await orchestrator.submit({
      clientJobId: `job-${Date.now()}-2a`,
      input: input2,
      inputHash: inputHash2,
    });

    // Submit same input again - should return existing job
    const job2b = await orchestrator.submit({
      clientJobId: `job-${Date.now()}-2b`,
      input: input2,
      inputHash: inputHash2,
    });

    console.log("Job 2a:", job2a.clientJobId);
    console.log("Job 2b (should be same as 2a):", job2b.clientJobId);
    console.log("Are they the same?", job2a.clientJobId === job2b.clientJobId);

    // Example 3: Multiple concurrent jobs
    console.log("\n--- Example 3: Multiple Concurrent Jobs ---");
    const jobs = await Promise.all([
      orchestrator.submit({
        clientJobId: `concurrent-${Date.now()}-1`,
        input: { prompt: "a cat" },
      }),
      orchestrator.submit({
        clientJobId: `concurrent-${Date.now()}-2`,
        input: { prompt: "a dog" },
      }),
      orchestrator.submit({
        clientJobId: `concurrent-${Date.now()}-3`,
        input: { prompt: "a bird" },
      }),
    ]);

    console.log(
      "Submitted concurrent jobs:",
      jobs.map((j) => j.clientJobId)
    );

    // Wait for all to complete
    const results = await Promise.all(
      jobs.map((job) =>
        orchestrator.awaitResult(job.clientJobId, 10 * 60 * 1000)
      )
    );

    console.log(
      "All concurrent jobs completed:",
      results.map((r) => r.status)
    );

    // Example 4: Job cancellation
    console.log("\n--- Example 4: Job Cancellation ---");
    const jobToCancel = await orchestrator.submit({
      clientJobId: `cancel-test-${Date.now()}`,
      input: { prompt: "This job will be canceled" },
    });

    console.log("Submitted job to cancel:", jobToCancel.clientJobId);

    // Cancel after 2 seconds
    setTimeout(async () => {
      try {
        await orchestrator.cancel(jobToCancel.clientJobId);
        console.log("Job canceled successfully");
      } catch (error) {
        console.error("Failed to cancel job:", error);
      }
    }, 2000);

    // Example 5: Recovery demonstration
    console.log("\n--- Example 5: Recovery ---");
    const recoveredCount = await orchestrator.recoverAllPending();
    console.log(`Recovered ${recoveredCount} pending jobs`);
  } catch (error) {
    console.error("Error in main:", error);
  } finally {
    // Clean shutdown
    console.log("\n--- Shutting down ---");
    await orchestrator.close();
    console.log("Orchestrator closed");
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nReceived SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Run the example
if (require.main === module) {
  main().catch(console.error);
}
