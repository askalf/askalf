# Dockerfile Security Audit Report
**Date:** 2026-02-10  
**Auditor:** DevOps  
**Status:** FINDINGS IDENTIFIED - IMPROVEMENTS RECOMMENDED

## Executive Summary
Reviewed 5 production Dockerfiles (api, forge, dashboard, self, mcp). Overall security posture is **GOOD** with several best practices already implemented. Identified **8 actionable improvements** for enhanced hardening.

---

## Current Security Strengths ✓

1. **Multi-stage builds** - All Dockerfiles use builder/runner pattern to minimize final image size
2. **Non-root users** - All services run as UID 1001 (substrate user)
3. **Read-only filesystems** - Production containers use `read_only: true` in docker-compose
4. **tmpfs mounts** - Writable `/tmp` isolated in memory
5. **Capability dropping** - `cap_drop: ALL` with minimal required capabilities
6. **No-new-privileges** - Security option prevents privilege escalation
7. **Resource limits** - CPU and memory limits defined in docker-compose
8. **Healthchecks** - All services include health checks
9. **Logging** - JSON-file logging with rotation configured

---

## Security Findings & Recommendations

### 1. **MISSING: HADOLINT VALIDATION**
**Severity:** INFO  
**Finding:** No automated Dockerfile linting in CI/CD pipeline

**Recommendation:**
- Add `hadolint` checks to git pre-commit hooks
- Include in CI pipeline to catch common issues early
- Examples of issues hadolint catches:
  - Missing `LABEL` for maintainer/version
  - Inefficient layer caching
  - Using `:latest` tags (all images are pinned - good!)

**Action:** Create `.hadolintignore` and add to CI

---

### 2. **IMPROVEMENT: ADD SBOM (Software Bill of Materials)**
**Severity:** INFO  
**Finding:** No SBOM generation for supply chain security

**Recommendation:**
- Generate SBOMs during build using `syft` or `cyclonedx`
- Store in artifact registry for compliance/audit
- Helps with CVE tracking and license compliance

**Action:** Add to build pipeline

---

### 3. **IMPROVEMENT: IMAGE SIGNING**
**Severity:** WARNING  
**Finding:** No image signature verification in production

**Recommendation:**
- Implement Cosign signing for built images
- Verify signatures during deployment
- Prevents unauthorized image tampering

**Action:** Configure image signing in registry

---

### 4. **DOCKERFILE OPTIMIZATION: Reduce layer count (API)**
**Severity:** INFO  
**Finding:** api/Dockerfile has 12 separate `pnpm --filter` build commands (creates 12 layers)

**Recommendation:**
```dockerfile
# Instead of:
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    ... (11 more commands)

# Consolidate to single RUN:
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/database build && \
    pnpm --filter @substrate/events build && \
    pnpm --filter @substrate/ai build && \
    pnpm --filter @substrate/sandbox build && \
    pnpm --filter @substrate/auth build && \
    pnpm --filter @substrate/memory build && \
    pnpm --filter @substrate/email build && \
    pnpm --filter @substrate/cognition build && \
    pnpm --filter @substrate/metabolic build && \
    pnpm --filter @substrate/stripe build && \
    pnpm --filter @substrate/api build
```

**Impact:** Reduces image layers, improves cache efficiency, smaller final image  
**Status:** EASY FIX - Already using && chains, just need consolidation

---

### 5. **SECURITY: Add HEALTHCHECK timeout verification**
**Severity:** INFO  
**Finding:** Dashboard Dockerfile uses `wget` in healthcheck, but image is Alpine (lighter)

**Recommendation:**
- Alpine images don't include `wget` by default
- Dashboard healthcheck uses `wget` - need to verify it's available
- Consider using `node -e` approach like other services for consistency

**Suggested Fix for dashboard/Dockerfile:**
```dockerfile
# Replace:
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3001/health || exit 1

# With:
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

---

### 6. **IMPROVEMENT: Add LABELS for metadata**
**Severity:** INFO  
**Finding:** Dockerfiles lack metadata labels (maintainer, version, description)

**Recommendation:**
Add to all Dockerfiles after FROM statement:
```dockerfile
LABEL maintainer="DevOps <devops@askalf.org>"
LABEL description="Substrate API Server - Production"
LABEL version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/askalf/substrate"
LABEL org.opencontainers.image.licenses="MIT"
```

**Benefits:**
- Better image tracking and documentation
- Supports container registry features
- Improves supply chain visibility

---

### 7. **SECURITY: Verify base image integrity**
**Severity:** WARNING  
**Finding:** Using public Docker Hub images without digest verification

**Current:**
```dockerfile
FROM node:20-slim AS builder
FROM node:20-alpine AS builder
```

**Recommendation:**
Use digest-pinned images:
```dockerfile
FROM node:20-slim@sha256:abc123...  # Specific digest
FROM node:20-alpine@sha256:def456...
```

**How to find digests:**
```bash
docker pull node:20-slim
docker inspect node:20-slim | grep -i digest
```

**Benefits:**
- Prevents image tag manipulation
- Ensures reproducible builds
- Better supply chain security

---

### 8. **IMPROVEMENT: Explicit ENTRYPOINT (not just CMD)**
**Severity:** INFO  
**Finding:** Using CMD without ENTRYPOINT allows container override

**Current:**
```dockerfile
CMD ["node", "dist/index.js"]
```

**Recommendation:**
```dockerfile
ENTRYPOINT ["node"]
CMD ["dist/index.js"]
```

**Benefits:**
- Prevents accidental command override
- Makes intent clearer
- Better for container orchestration

---

## Docker Compose Security Review

### Strengths in docker-compose.prod.yml:
✓ All services have `read_only: true`  
✓ All have `cap_drop: ALL` with minimal additions  
✓ Resource limits configured  
✓ No privileged containers  
✓ No host networking  
✓ Environment variables not hardcoded  
✓ Volumes properly scoped  

### Recommendations:
1. **Network isolation**: Consider creating separate networks for:
   - Database layer (postgres, redis, pgbouncer)
   - Application layer (api, dashboard, mcp, forge, self)
   - Infrastructure layer (nginx, cloudflared)
   
   Currently all on `substrate-prod-net` - fine for small deployments but reduces blast radius isolation.

2. **Secrets management**: Currently using `.env` file
   - Consider Docker Secrets for swarm mode
   - Or use external secret manager (HashiCorp Vault, AWS Secrets Manager)
   - Ensure `.env` file has restricted permissions (600)

3. **Logging**: All services use `json-file` driver with rotation
   - Consider adding log aggregation (ELK, Datadog, etc.)
   - Current setup loses logs on container removal

---

## Vulnerability Scanning Recommendations

### Implement automated scanning:

1. **Build-time scanning:**
   ```bash
   # Scan for known vulnerabilities
   trivy image --severity HIGH,CRITICAL my-image:tag
   ```

2. **Base image scanning:**
   - Set up Dependabot/Renovate to update base images
   - node:20-slim and node:20-alpine are actively maintained (good)

3. **Dependency scanning:**
   - `npm audit` already in security_scan tool
   - Consider SCA tool (Snyk, WhiteSource)

---

## Compliance Checklist

- [x] Non-root user execution
- [x] Resource limits
- [x] Read-only filesystem
- [x] Healthchecks
- [x] No hardcoded secrets
- [x] Capability dropping
- [x] No privileged containers
- [x] Logging configured
- [ ] Image signing/verification
- [ ] SBOM generation
- [ ] Hadolint validation
- [ ] Digest-pinned base images
- [ ] LABELS metadata
- [ ] Network segmentation (partial)

---

## Priority Action Items

### HIGH (Security Impact):
1. Implement image digest pinning for base images
2. Add image signing and verification
3. Verify dashboard healthcheck `wget` availability

### MEDIUM (Best Practices):
1. Add SBOM generation to build pipeline
2. Consolidate RUN layers to reduce image size
3. Add metadata labels to all Dockerfiles

### LOW (Nice to Have):
1. Add Hadolint linting
2. Implement network segmentation
3. Upgrade to external secrets management

---

## Next Steps

1. **Create GitHub issues** for each recommendation
2. **Add to CI/CD pipeline:**
   - Hadolint checks
   - Trivy vulnerability scanning
   - SBOM generation
3. **Update base images** to digest-pinned versions
4. **Add labels** to all Dockerfiles
5. **Implement image signing** in registry
6. **Test** all changes in dev environment before prod deployment

---

## References

- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Hadolint](https://github.com/hadolint/hadolint)
- [Trivy](https://github.com/aquasecurity/trivy)
- [Cosign Image Signing](https://github.com/sigstore/cosign)
- [OWASP Container Security](https://owasp.org/www-project-container-security/)

