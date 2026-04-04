/**
 * SUBSTRATE Security Module
 *
 * Provides protection against:
 * - Prompt injection attacks
 * - Malicious payloads
 * - Rate limiting / DDoS
 * - Anomaly detection
 */

export {
  InjectionScanner,
  RateLimiter,
  AnomalyDetector,
  scanner,
  rateLimiter,
  anomalyDetector,
  type ScanResult,
  type ThreatDetection,
  type ThreatType
} from './injection-scanner.js';

// Shard logic scanner for procedural shard security
export {
  ShardLogicScanner,
  shardLogicScanner,
  ShardLogicBlockedError,
  ShardLogicFlaggedError,
  type ShardScanResult,
  type ShardLogicScannerConfig,
} from './shard-logic-scanner.js';

// Internal service-to-service HMAC signing
export {
  createInternalHeaders,
  verifyInternalRequest,
} from './internal-hmac.js';

// Re-export a convenient middleware-style function
import { scanner, rateLimiter, type ScanResult } from './injection-scanner.js';

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  scanResult?: ScanResult;
  rateLimit?: { remaining: number; resetMs: number };
}

/**
 * Combined security check for incoming requests
 */
export function securityCheck(
  input: string,
  identifier: string,
  options: {
    skipRateLimit?: boolean;
    skipInjectionScan?: boolean;
    strictMode?: boolean;
  } = {}
): SecurityCheckResult {
  // Rate limit check
  if (!options.skipRateLimit) {
    const rateCheck = rateLimiter.check(identifier);
    if (!rateCheck.allowed) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        rateLimit: { remaining: rateCheck.remaining, resetMs: rateCheck.resetMs }
      };
    }
  }

  // Injection scan
  if (!options.skipInjectionScan) {
    const scanResult = scanner.scan(input);

    if (!scanResult.safe) {
      const criticalThreats = scanResult.threats.filter(t => t.severity === 'critical');
      const highThreats = scanResult.threats.filter(t => t.severity === 'high');

      // Block critical threats always
      if (criticalThreats.length > 0 && criticalThreats[0]) {
        return {
          allowed: false,
          reason: `Blocked: ${criticalThreats[0].description}`,
          scanResult
        };
      }

      // Block high threats in strict mode
      if (options.strictMode && highThreats.length > 0 && highThreats[0]) {
        return {
          allowed: false,
          reason: `Blocked (strict): ${highThreats[0].description}`,
          scanResult
        };
      }

      // Block if risk score too high
      if (scanResult.riskScore >= 50) {
        return {
          allowed: false,
          reason: `Risk score too high: ${scanResult.riskScore}`,
          scanResult
        };
      }
    }

    const result: SecurityCheckResult = {
      allowed: true,
      scanResult
    };

    if (!options.skipRateLimit) {
      const rateCheck = rateLimiter.check(identifier);
      result.rateLimit = { remaining: rateCheck.remaining, resetMs: rateCheck.resetMs };
    }

    return result;
  }

  return { allowed: true };
}

/**
 * Sanitize user input for safe storage/display
 */
export function sanitize(input: string): string {
  return scanner.scan(input).sanitized;
}

/**
 * Quick safety check
 */
export function isSafe(input: string): boolean {
  return scanner.isSafe(input);
}
