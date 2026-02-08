# Performance Report

**Date:** 2026-01-22
**Analyzer:** Claude Code

## Database Performance

### Index Usage Summary

| Index | Scans | Tuples Read | Status |
|-------|-------|-------------|--------|
| tenants_pkey | 1,195 | 1,195 | GOOD |
| idx_sessions_token | 1,074 | 1,074 | GOOD |
| idx_connectors_tenant | 548 | 108 | GOOD |
| idx_shards_lifecycle | 237 | 11,546 | GOOD |
| idx_facts_confidence | 214 | 47,936 | OK |
| idx_exec_created | 173 | 634,967 | REVIEW |

### Sequential Scan Analysis

| Table | Seq Scans | Rows Read | Issue |
|-------|-----------|-----------|-------|
| users | 1,839 | 3,561 | OK (small table, 2 rows) |
| shard_executions | 699 | 36.8M | REVIEW |
| chat_messages | 689 | 5,752 | OK (has index) |
| episodes | 221 | 11.4M | REVIEW |
| procedural_shards | 277 | 14,711 | OK |

### Recommendations

#### 1. shard_executions Table (52,674 rows)
**Issue:** 699 sequential scans reading 36.8M rows total
**Cause:** Likely aggregate queries or date-range scans
**Fix:** Consider partitioning by date or adding composite index:
```sql
CREATE INDEX idx_exec_tenant_created ON shard_executions(tenant_id, created_at DESC);
```

#### 2. episodes Table
**Issue:** 221 sequential scans reading 11.4M rows
**Cause:** Full table scans for episode matching
**Fix:** Add embedding index if not present, or limit query scope

#### 3. idx_exec_created High Tuple Fetch
**Issue:** 173 scans but 634,967 tuples fetched
**Cause:** Wide date range queries
**Fix:** Add LIMIT to queries or partition table

---

## nginx Caching

### Current Configuration
- Static files: 1 day cache
- API responses: 30 second microcache for GET /shards, /facts
- Cache zones properly configured

### Recommendations
- Add `Cache-Control` headers for SPA assets
- Consider CDN for static assets

---

## Connection Pooling

### pgbouncer Status
- Configured with transaction pooling
- Protects PostgreSQL from connection storms
- Essential for consumer-scale traffic

---

## Resource Usage

### Estimated Bottlenecks
1. **Database** - Main bottleneck at scale (solved with pgbouncer)
2. **Redis** - Session storage, event bus (low risk)
3. **API CPU** - LLM response processing (offloaded to providers)

---

## Quick Wins

1. **Add composite indexes** for common query patterns
2. **Enable nginx microcache** for more endpoints
3. **Consider table partitioning** for shard_executions (by month)
4. **Add VACUUM ANALYZE** to daily cron

---

## Monitoring Recommendations

1. Add pg_stat_statements for query analysis
2. Monitor connection pool saturation
3. Track cache hit rates
4. Alert on sequential scan increases
