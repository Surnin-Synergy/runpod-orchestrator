import { RunpodJobStatus, RunpodRunResponse } from "./types";
import { RUNPOD_STATUS_MAP } from "./constants";

export class RunpodClient {
  private baseUrl: string;
  private apiKey: string;
  private endpointId: string;

  constructor(apiKey: string, endpointId: string) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
    this.baseUrl = "https://api.runpod.ai/v2";
  }

  async run(input: unknown): Promise<RunpodRunResponse> {
    const url = `${this.baseUrl}/${this.endpointId}/run`;

    const requestBody = { input };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Runpod run failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = (await response.json()) as any;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`Runpod run error: ${data.errors[0].message}`);
    }

    return { id: data.id };
  }

  async status(jobId: string): Promise<RunpodJobStatus> {
    const url = `${this.baseUrl}/${this.endpointId}/status/${jobId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          id: jobId,
          status: "NOT_FOUND",
          error: "Job not found or expired",
        };
      }

      const errorText = await response.text();
      console.log("Runpod status error response body:", errorText);
      throw new Error(
        `Runpod status failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = (await response.json()) as any;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`Runpod status error: ${data.errors[0].message}`);
    }

    return data;
  }

  async cancel(jobId: string): Promise<void> {
    const url = `${this.baseUrl}/${this.endpointId}/cancel/${jobId}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("Runpod cancel error response body:", errorText);
      throw new Error(
        `Runpod cancel failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = (await response.json()) as any;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`Runpod cancel error: ${data.errors[0].message}`);
    }
  }

  async stream(jobId: string): Promise<ReadableStream<Uint8Array> | null> {
    // Note: This is a placeholder for streaming functionality
    // Runpod's actual streaming implementation would depend on their API
    // For now, we'll return null to indicate streaming is not available
    return null;
  }

  mapRunpodStatus(runpodStatus: string): string {
    return (
      RUNPOD_STATUS_MAP[runpodStatus as keyof typeof RUNPOD_STATUS_MAP] ||
      "FAILED"
    );
  }

  isTransientError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("enotfound")
    ) {
      return true;
    }

    // HTTP 5xx errors
    if (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504")
    ) {
      return true;
    }

    // Rate limiting
    if (message.includes("429") || message.includes("rate limit")) {
      return true;
    }

    return false;
  }
}
