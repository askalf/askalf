import pg from 'pg';
import https from 'https';

const { Pool } = pg;

const pool = new Pool({
  host: 'substrate-prod-postgres',
  port: 5432,
  database: 'substrate',
  user: 'substrate',
  password: process.env.POSTGRES_PASSWORD || 'caff003669dce684448cb89002333263a8684242f43db4e2',
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1536;

async function generateEmbedding(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.data[0].embedding);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, patterns FROM procedural_shards
       WHERE embedding IS NULL
         AND patterns IS NOT NULL
         AND array_length(patterns, 1) > 0`
    );

    console.log(`Found ${result.rows.length} shards needing pattern embeddings`);

    let updated = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        const patterns = Array.isArray(row.patterns) ? row.patterns : [];
        const text = patterns.join(' ');
        if (!text.trim()) {
          console.log(`  Skipping ${row.id} - empty patterns`);
          continue;
        }

        const embedding = await generateEmbedding(text);
        await client.query(
          `UPDATE procedural_shards SET embedding = $1 WHERE id = $2`,
          [`[${embedding.join(',')}]`, row.id]
        );
        updated++;
        if (updated % 25 === 0) {
          console.log(`  Progress: ${updated}/${result.rows.length}`);
        }
      } catch (err) {
        console.error(`  Error on ${row.id}: ${err.message}`);
        errors++;
        // Brief pause on error to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log(`Done! Updated: ${updated}, Errors: ${errors}, Total: ${result.rows.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
