# Backup System Documentation

## Overview

The Ask ALF backup system provides automated PostgreSQL database backups with support for both the main application database and the Substrate blockchain database. The system runs as a containerized service with scheduled backups, REST API control, and comprehensive monitoring.

## Architecture

### Components

1. **Backup Service Container** (`backup`)
   - Built from `scripts/Dockerfile.backup`
   - Runs backup API server and cron scheduler
   - Mounts backup volume at `/backups`
   - Connected to database networks

2. **Backup API** (`backup-api.js`)
   - Express REST API on port 8080
   - Provides manual backup triggers and status monitoring
   - Health check endpoint for container orchestration

3. **Backup Scripts**
   - `backup-entrypoint-unified.sh` - Container entrypoint with cron configuration
   - `backup-substrate.sh` - Substrate database backup logic
   - `restore-substrate.sh` - Substrate database restore logic

4. **Storage**
   - Volume: `askalf_backups`
   - Location: `/backups` in container
   - Retention: Configurable per backup type

## Backup Types

### 1. Main Application Database
- **Database**: PostgreSQL (main app data)
- **Schedule**: Configured via cron in entrypoint
- **Format**: SQL dump via `pg_dump`
- **Naming**: `backup-{timestamp}.sql`

### 2. Substrate Blockchain Database
- **Database**: PostgreSQL (Substrate chain data)
- **Schedule**: Configurable via `BACKUP_SCHEDULE` environment variable
- **Format**: Custom PostgreSQL dump
- **Naming**: `substrate-backup-{timestamp}.dump`
- **Special Features**:
  - Supports incremental backups
  - Compression enabled
  - Metadata tracking

## API Endpoints

### Health Check
```http
GET /health
```

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Trigger Manual Backup
```http
POST /backup
Content-Type: application/json

{
  "type": "substrate",
  "compress": true
}
```

**Parameters**:
- `type` (optional): `"substrate"` or `"main"` (default: `"substrate"`)
- `compress` (optional): boolean (default: `true`)

**Response**:
```json
{
  "success": true,
  "filename": "substrate-backup-20240115-103000.dump",
  "size": "1.2GB",
  "duration": "45s"
}
```

### List Backups
```http
GET /backups
```

**Response**:
```json
{
  "backups": [
    {
      "filename": "substrate-backup-20240115-103000.dump",
      "size": "1.2GB",
      "created": "2024-01-15T10:30:00Z",
      "type": "substrate"
    }
  ]
}
```

### Get Backup Status
```http
GET /status
```

**Response**:
```json
{
  "lastBackup": "2024-01-15T10:30:00Z",
  "nextScheduled": "2024-01-16T02:00:00Z",
  "backupCount": 7,
  "totalSize": "8.4GB",
  "oldestBackup": "2024-01-08T02:00:00Z"
}
```

## Backup Procedures

### Automated Backups

Backups run automatically via cron scheduler configured in `backup-entrypoint-unified.sh`:

1. Container starts and initializes cron
2. Scheduled backup triggers at configured time
3. Script executes `backup-substrate.sh` or equivalent
4. Backup file written to `/backups` volume
5. Old backups rotated based on retention policy
6. Logs written to container stdout

### Manual Backup via API

```bash
# Trigger substrate backup
curl -X POST http://backup:8080/backup \
  -H "Content-Type: application/json" \
  -d '{"type": "substrate", "compress": true}'

# Trigger main database backup
curl -X POST http://backup:8080/backup \
  -H "Content-Type: application/json" \
  -d '{"type": "main"}'
```

### Manual Backup via Shell

```bash
# Enter backup container
docker exec -it askalf-backup bash

# Run substrate backup manually
/scripts/backup-substrate.sh

# Check backup files
ls -lh /backups/
```

## Restore Procedures

### Restore Substrate Database

```bash
# 1. Stop services that use the database
docker-compose stop substrate-node

# 2. Enter backup container
docker exec -it askalf-backup bash

# 3. Run restore script
/scripts/restore-substrate.sh /backups/substrate-backup-20240115-103000.dump

# 4. Verify restore
psql -U substrate -d substrate_db -c "SELECT COUNT(*) FROM blocks;"

# 5. Restart services
docker-compose start substrate-node
```

### Restore Main Database

```bash
# 1. Stop application services
docker-compose stop web api

# 2. Enter backup container or database container
docker exec -it askalf-db bash

# 3. Restore from backup
psql -U postgres -d askalf < /backups/backup-20240115-103000.sql

# 4. Verify restore
psql -U postgres -d askalf -c "SELECT COUNT(*) FROM users;"

# 5. Restart services
docker-compose start web api
```

## Configuration

### Environment Variables

Set these in `docker-compose.yml` for the backup service:

- `BACKUP_SCHEDULE` - Cron expression for automated backups (default: `0 2 * * *` - daily at 2 AM)
- `BACKUP_RETENTION_DAYS` - Number of days to keep backups (default: `7`)
- `POSTGRES_HOST` - Database host (default: `db`)
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database password
- `POSTGRES_DB` - Database name
- `SUBSTRATE_DB_HOST` - Substrate database host
- `SUBSTRATE_DB_USER` - Substrate database user
- `SUBSTRATE_DB_PASSWORD` - Substrate database password
- `SUBSTRATE_DB_NAME` - Substrate database name

### Docker Compose Configuration

```yaml
backup:
  build:
    context: ./scripts
    dockerfile: Dockerfile.backup
  container_name: askalf-backup
  volumes:
    - askalf_backups:/backups
    - ./scripts:/scripts:ro
  environment:
    - BACKUP_SCHEDULE=0 2 * * *
    - BACKUP_RETENTION_DAYS=7
    - POSTGRES_HOST=db
    - SUBSTRATE_DB_HOST=substrate-db
  networks:
    - askalf-network
  restart: unless-stopped
```

## Monitoring

### Health Checks

```bash
# Check backup service health
curl http://backup:8080/health

# Check from host (if port exposed)
curl http://localhost:8080/health
```

### Logs

```bash
# View backup service logs
docker logs askalf-backup

# Follow logs in real-time
docker logs -f askalf-backup

# View last 100 lines
docker logs --tail 100 askalf-backup
```

### Backup Verification

```bash
# List all backups
curl http://backup:8080/backups

# Check backup status
curl http://backup:8080/status

# Verify backup files directly
docker exec askalf-backup ls -lh /backups/
```

## Troubleshooting

### Backup Fails to Run

1. Check container logs: `docker logs askalf-backup`
2. Verify database connectivity: `docker exec askalf-backup pg_isready -h db`
3. Check disk space: `docker exec askalf-backup df -h /backups`
4. Verify environment variables: `docker exec askalf-backup env | grep POSTGRES`

### Backup Files Not Created

1. Check permissions: `docker exec askalf-backup ls -la /backups`
2. Verify cron is running: `docker exec askalf-backup ps aux | grep cron`
3. Check cron logs: `docker exec askalf-backup cat /var/log/cron.log`
4. Test backup script manually: `docker exec askalf-backup /scripts/backup-substrate.sh`

### Restore Fails

1. Verify backup file integrity: `docker exec askalf-backup file /backups/your-backup.dump`
2. Check database is accessible: `docker exec askalf-backup psql -U postgres -l`
3. Ensure target database exists: `docker exec askalf-backup psql -U postgres -c "CREATE DATABASE substrate_db;"`
4. Check for conflicting connections: Stop services before restore

### API Not Responding

1. Check if service is running: `docker ps | grep backup`
2. Verify port binding: `docker port askalf-backup`
3. Check API logs: `docker logs askalf-backup | grep "Backup API"`
4. Test from inside container: `docker exec askalf-backup curl localhost:8080/health`

## Security Considerations

### Access Control

- Backup API has no authentication by default - restrict network access
- Use Docker networks to isolate backup service
- Do not expose backup API port to public internet
- Secure backup volume with appropriate permissions

### Sensitive Data

- Backups contain full database dumps including sensitive data
- Encrypt backup volume at rest
- Secure backup file transfers
- Implement backup retention policies
- Use secure credentials in environment variables

### Best Practices

1. **Regular Testing**: Test restore procedures monthly
2. **Monitoring**: Set up alerts for backup failures
3. **Retention**: Balance storage costs with recovery needs
4. **Offsite Backups**: Copy backups to offsite storage regularly
5. **Encryption**: Encrypt backups before offsite transfer
6. **Access Logs**: Monitor backup API access logs
7. **Version Control**: Keep backup scripts in version control

## Maintenance

### Regular Tasks

- **Daily**: Monitor backup completion
- **Weekly**: Verify backup integrity
- **Monthly**: Test restore procedures
- **Quarterly**: Review retention policies and storage usage

### Backup Rotation

Automated rotation based on `BACKUP_RETENTION_DAYS`:

```bash
# Manual rotation (keeps last 7 days)
docker exec askalf-backup find /backups -name "*.dump" -mtime +7 -delete
docker exec askalf-backup find /backups -name "*.sql" -mtime +7 -delete
```

### Storage Management

```bash
# Check backup volume usage
docker exec askalf-backup du -sh /backups/*

# Compress old backups
docker exec askalf-backup gzip /backups/old-backup.sql

# Archive to external storage
docker cp askalf-backup:/backups/substrate-backup-20240115.dump ./archive/
```

## Integration

### Monitoring Integration

Backup service can be monitored via:

- Prometheus metrics (if exposed)
- Health check endpoint polling
- Log aggregation (ELK, Loki)
- Docker health checks

### Alert Configuration

Example alert rules:

- Backup age > 25 hours (daily backups)
- Backup size deviation > 50% from average
- API health check fails
- Backup volume > 90% full

## Future Enhancements

- [ ] Incremental backup support for main database
- [ ] Automated offsite backup sync
- [ ] Backup encryption at rest
- [ ] Point-in-time recovery (PITR)
- [ ] Backup compression optimization
- [ ] Multi-region backup replication
- [ ] Backup verification automation
- [ ] Restore time estimation
- [ ] Backup diff/comparison tools

## References

- PostgreSQL Backup Documentation: https://www.postgresql.org/docs/current/backup.html
- Docker Volume Management: https://docs.docker.com/storage/volumes/
- Cron Expression Guide: https://crontab.guru/

---

**Last Updated**: 2024-01-15  
**Maintained By**: Doc Writer Agent  
**Version**: 1.0
