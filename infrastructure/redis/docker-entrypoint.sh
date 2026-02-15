#!/bin/sh
set -e

# Generate ACL file from REDIS_PASSWORD environment variable
# Replaces deprecated rename-command (removed in Redis 8) with ACL rules
# Default user: full access except dangerous admin commands
# Admin user: full access (for maintenance via redis-cli)
cat > /data/users.acl <<EOF
user default on >${REDIS_PASSWORD} ~* &* +@all -FLUSHALL -FLUSHDB -DEBUG -KEYS -CONFIG -SHUTDOWN -SLAVEOF -REPLICAOF -BGREWRITEAOF -BGSAVE -SAVE
user admin on >${REDIS_PASSWORD} ~* &* +@all
EOF

exec redis-server /usr/local/etc/redis/redis.conf
