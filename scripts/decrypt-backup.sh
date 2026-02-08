#!/bin/bash
# Decrypt a SUBSTRATE backup file
# Usage: ./decrypt-backup.sh <encrypted-file.sql.gz.enc> <output-file.sql.gz>

set -e

if [ $# -lt 2 ]; then
  echo "Usage: $0 <encrypted-file.sql.gz.enc> <output-file.sql.gz>"
  echo "  Set BACKUP_ENCRYPTION_KEY environment variable with the decryption key"
  exit 1
fi

INPUT_FILE="$1"
OUTPUT_FILE="$2"

if [ -z "${BACKUP_ENCRYPTION_KEY}" ]; then
  echo "Error: BACKUP_ENCRYPTION_KEY environment variable not set"
  exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
  echo "Error: Input file not found: $INPUT_FILE"
  exit 1
fi

echo "Decrypting: $INPUT_FILE -> $OUTPUT_FILE"

openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 \
  -in "$INPUT_FILE" \
  -out "$OUTPUT_FILE" \
  -pass env:BACKUP_ENCRYPTION_KEY

echo "Decryption complete: $OUTPUT_FILE"
echo ""
echo "To restore, run:"
echo "  gunzip -c $OUTPUT_FILE | docker exec -i substrate-prod-postgres psql -U substrate -d substrate"
