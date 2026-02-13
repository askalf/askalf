/**
 * Internal service health check utility
 */

export interface HealthCheckResult {
  service: string;
  healthy: boolean;
  latency: number;
  error?: string;
}

export async function checkServiceHealth(
  service: string,
  url: string,
): Promise<HealthCheckResult> {
  const start = performance.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const latency = Math.round(performance.now() - start);

    // Consume body to allow connection reuse
    await response.body?.cancel();

    if (!response.ok) {
      return {
        service,
        healthy: false,
        latency,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    return { service, healthy: true, latency };
  } catch (err) {
    const latency = Math.round(performance.now() - start);
    const message =
      err instanceof Error ? err.message : 'Unknown error';

    return {
      service,
      healthy: false,
      latency,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
