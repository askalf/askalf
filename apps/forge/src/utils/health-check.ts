/**
 * Health check utility for internal service monitoring
 * Performs HTTP health checks with timeout and latency tracking
 */

export interface HealthCheckResult {
  service: string;
  healthy: boolean;
  latency: number;
  error?: string;
}

/**
 * Check the health of a service by performing a fetch request with timeout
 * 
 * @param service - Name of the service being checked
 * @param url - URL endpoint to check
 * @returns Health check result with service name, health status, latency, and optional error
 * 
 * @example
 * ```ts
 * const result = await checkServiceHealth('api', 'http://localhost:3000/health');
 * console.log(`${result.service} is ${result.healthy ? 'healthy' : 'unhealthy'} (${result.latency}ms)`);
 * ```
 */
export async function checkServiceHealth(
  service: string,
  url: string
): Promise<HealthCheckResult> {
  const startTime = performance.now();
  
  try {
    // Create an AbortController for the 5-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // Perform the fetch request
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AskALF-HealthCheck/1.0',
      },
    });
    
    // Clear the timeout
    clearTimeout(timeoutId);
    
    // Calculate latency
    const latency = Math.round(performance.now() - startTime);
    
    // Check if response is successful (2xx status code)
    const healthy = response.ok;
    
    if (!healthy) {
      return {
        service,
        healthy: false,
        latency,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    
    return {
      service,
      healthy: true,
      latency,
    };
  } catch (error) {
    const latency = Math.round(performance.now() - startTime);
    
    // Handle different types of errors
    let errorMessage: string;
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = 'Request timeout (5s)';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = 'Connection failed';
      } else {
        errorMessage = error.message;
      }
    } else {
      errorMessage = 'Unknown error';
    }
    
    return {
      service,
      healthy: false,
      latency,
      error: errorMessage,
    };
  }
}
