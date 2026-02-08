SELECT DISTINCT shard_type, COUNT(*) as count FROM procedural_shards GROUP BY shard_type ORDER BY count DESC;
