// FEEDBACK LOOP RUNNER
// The integration that closes the learning loop
module.paths.unshift('/app/node_modules');

const { Pool } = require('pg');
const vm = require('vm');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://substrate:caff003669dce684448cb89002333263a8684242f43db4e2@pgbouncer:5432/substrate'
});

// Cache for feedback shards
const feedbackShards = {};

function exec(logic, input) {
  try {
    const sb = {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      result: undefined,
      JSON, Object, Array, String, Number, Boolean, Math,
      parseInt, parseFloat, RegExp, Date,
      console: { log: () => {} }
    };
    vm.runInContext(logic + '\nif(typeof execute==="function"){result=execute(input);}',
      vm.createContext(sb), { timeout: 5000 });
    if (sb.result === undefined) return null;
    return typeof sb.result === 'string' ? JSON.parse(sb.result) : sb.result;
  } catch (e) {
    return null;
  }
}

async function loadFeedbackShards() {
  const { rows } = await pool.query(`
    SELECT name, logic FROM procedural_shards WHERE category = 'feedback'
  `);
  for (const row of rows) {
    feedbackShards[row.name] = row.logic;
  }
  console.log(`Loaded ${Object.keys(feedbackShards).length} feedback shards`);
}

function runShard(name, input) {
  if (!feedbackShards[name]) {
    console.log(`  ! Shard not found: ${name}`);
    return null;
  }
  return exec(feedbackShards[name], input);
}

// ============================================================
// STEP 1: Record Attribution
// Called when a shard contributes to a response
// ============================================================
async function recordAttribution(data) {
  const result = runShard('attribution-recorder', data);
  if (!result || !result.recorded) return false;

  const attr = result.attribution;
  await pool.query(`
    INSERT INTO response_attributions
    (conversation_id, message_id, user_id, shard_id, shard_name, input_given, output_produced, execution_time_ms, confidence_at_execution, memory_context)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    attr.conversation_id, attr.message_id, attr.user_id,
    attr.shard_id, attr.shard_name, attr.input_given,
    attr.output_produced, attr.execution_time_ms,
    attr.confidence_at_execution, JSON.stringify(attr.memory_context || {})
  ]);

  return true;
}

// ============================================================
// STEP 2: Classify Feedback
// Called when user provides feedback (explicit or implicit)
// ============================================================
async function classifyAndStoreFeedback(conversationId, messageId, userId, text, behavior) {
  const result = runShard('feedback-classifier', { text, behavior });
  if (!result) return null;

  const { rows } = await pool.query(`
    INSERT INTO user_feedback
    (conversation_id, message_id, user_id, feedback_type, feedback_value, feedback_score, session_continued)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    conversationId, messageId, userId,
    result.feedback_type,
    text || JSON.stringify(behavior),
    result.feedback_score,
    behavior?.session_continued || false
  ]);

  return { ...result, feedback_id: rows[0].id };
}

// ============================================================
// STEP 3: Propagate Feedback to Shards
// Called after feedback is classified
// ============================================================
async function propagateFeedback(feedbackId, feedbackScore, messageId) {
  // Get attributions for this message
  const { rows: attributions } = await pool.query(`
    SELECT ra.shard_id, ra.shard_name, ps.outcome_score as current_outcome_score
    FROM response_attributions ra
    JOIN procedural_shards ps ON ra.shard_id = ps.id
    WHERE ra.message_id = $1
  `, [messageId]);

  if (attributions.length === 0) {
    console.log('  No attributions found for message');
    return { propagated: false, reason: 'no_attributions' };
  }

  const result = runShard('feedback-propagator', {
    feedback_id: feedbackId,
    feedback_score: feedbackScore,
    attributions: attributions.map(a => ({
      shard_id: a.shard_id,
      attribution_strength: 1.0,
      current_outcome_score: a.current_outcome_score
    }))
  });

  if (!result || !result.propagated) return result;

  // Apply the propagations
  for (const prop of result.propagations) {
    await pool.query(`
      UPDATE procedural_shards
      SET outcome_score = $1, outcome_count = outcome_count + 1, last_outcome_at = NOW()
      WHERE id = $2
    `, [prop.new_score, prop.shard_id]);

    // Log the propagation
    await pool.query(`
      INSERT INTO feedback_propagation
      (feedback_id, shard_id, previous_outcome_score, new_outcome_score, score_delta, propagation_weight, attribution_strength)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [feedbackId, prop.shard_id, prop.previous_score, prop.new_score, prop.delta, 0.1, prop.attribution_strength]);

    // Update shard_outcomes
    if (feedbackScore > 0) {
      await pool.query(`
        UPDATE shard_outcomes
        SET positive_outcomes = positive_outcomes + 1,
            outcome_score = $1,
            last_positive_at = NOW(),
            updated_at = NOW()
        WHERE shard_id = $2
      `, [prop.new_score, prop.shard_id]);
    } else {
      await pool.query(`
        UPDATE shard_outcomes
        SET negative_outcomes = negative_outcomes + 1,
            outcome_score = $1,
            last_negative_at = NOW(),
            updated_at = NOW()
        WHERE shard_id = $2
      `, [prop.new_score, prop.shard_id]);
    }
  }

  console.log(`  Propagated to ${result.propagations.length} shards`);
  return result;
}

// ============================================================
// STEP 4: Calculate System Health
// Called periodically
// ============================================================
async function calculateSystemHealth() {
  const { rows: metrics } = await pool.query(`
    SELECT
      COUNT(DISTINCT ra.message_id) as total_responses,
      COUNT(DISTINCT uf.message_id) as responses_with_feedback,
      COUNT(CASE WHEN uf.feedback_score > 0 THEN 1 END) as positive_feedback,
      COUNT(CASE WHEN uf.feedback_score < 0 THEN 1 END) as negative_feedback
    FROM response_attributions ra
    LEFT JOIN user_feedback uf ON ra.message_id = uf.message_id
    WHERE ra.created_at > NOW() - INTERVAL '24 hours'
  `);

  const m = metrics[0];
  const result = runShard('help-rate-analyzer', {
    period_type: 'daily',
    metrics: {
      total_responses: parseInt(m.total_responses) || 0,
      responses_with_feedback: parseInt(m.responses_with_feedback) || 0,
      positive_feedback: parseInt(m.positive_feedback) || 0,
      negative_feedback: parseInt(m.negative_feedback) || 0
    }
  });

  if (result) {
    await pool.query(`
      INSERT INTO outcome_metrics
      (period_start, period_end, period_type, total_responses, responses_with_feedback, positive_feedback_count, negative_feedback_count, feedback_rate, positive_rate, help_rate)
      VALUES (NOW() - INTERVAL '24 hours', NOW(), 'daily', $1, $2, $3, $4, $5, $6, $7)
    `, [m.total_responses, m.responses_with_feedback, m.positive_feedback, m.negative_feedback,
        result.feedback_rate, result.positive_rate, result.help_rate]);
  }

  return result;
}

// ============================================================
// STEP 5: Run Reinforcement Learning
// Adjusts shard priorities based on outcomes
// ============================================================
async function runReinforcementLearning() {
  const { rows: shards } = await pool.query(`
    SELECT
      ps.id as shard_id,
      ps.name as shard_name,
      ps.outcome_score,
      ps.outcome_count,
      CASE WHEN ps.execution_count > 0
           THEN ps.success_count::float / ps.execution_count
           ELSE 1.0 END as execution_success_rate,
      so.trend
    FROM procedural_shards ps
    LEFT JOIN shard_outcomes so ON ps.id = so.shard_id
    WHERE ps.lifecycle IN ('testing', 'promoted')
    AND ps.outcome_count > 0
    ORDER BY ps.outcome_count DESC
    LIMIT 50
  `);

  const actions = { promote: 0, maintain: 0, review: 0, deprioritize: 0, observe: 0 };

  for (const shard of shards) {
    const result = runShard('reinforcement-learner', {
      shard_id: shard.shard_id,
      shard_name: shard.shard_name,
      outcome_score: shard.outcome_score,
      execution_success_rate: shard.execution_success_rate,
      outcome_count: shard.outcome_count,
      trend: shard.trend || 'stable'
    });

    if (result) {
      actions[result.action]++;

      // Update confidence based on reinforcement
      if (result.confidence_adjustment !== 0) {
        await pool.query(`
          UPDATE procedural_shards
          SET outcome_confidence = LEAST(1, GREATEST(0, outcome_confidence + $1))
          WHERE id = $2
        `, [result.confidence_adjustment, shard.shard_id]);
      }
    }
  }

  return actions;
}

// ============================================================
// MAIN: Run Complete Feedback Loop
// ============================================================
async function runFeedbackLoop() {
  console.log('═'.repeat(60));
  console.log('FEEDBACK LOOP - ' + new Date().toISOString());
  console.log('═'.repeat(60));

  await loadFeedbackShards();

  // Simulate some feedback processing (in production, this comes from real events)
  console.log('\n--- Processing Simulated Feedback ---');

  // Generate test attributions and feedback
  const testMessages = [];
  const { rows: uuids } = await pool.query(`
    SELECT gen_random_uuid() as conv_id, gen_random_uuid() as user_id
  `);
  const convId = uuids[0].conv_id;
  const userId = uuids[0].user_id;

  for (let i = 0; i < 5; i++) {
    const { rows: msgUuid } = await pool.query('SELECT gen_random_uuid() as id');
    const msgId = msgUuid[0].id;

    // Pick random shards to attribute
    const { rows: randomShards } = await pool.query(`
      SELECT id, name FROM procedural_shards
      WHERE lifecycle IN ('testing', 'promoted')
      ORDER BY RANDOM() LIMIT 3
    `);

    for (const shard of randomShards) {
      await recordAttribution({
        conversation_id: convId,
        message_id: msgId,
        user_id: userId,
        shard_id: shard.id,
        shard_name: shard.name,
        input: 'test input',
        output: 'test output',
        confidence: 0.8
      });
    }

    testMessages.push({ msgId, convId, userId });
  }

  console.log(`  Created ${testMessages.length} test messages with attributions`);

  // Simulate feedback on those messages
  const feedbackTexts = [
    { text: 'Thanks, that was helpful!', expected: 'positive' },
    { text: 'Perfect, exactly what I needed', expected: 'positive' },
    { text: 'This is wrong', expected: 'negative' },
    { text: 'okay', expected: 'neutral' },
    { text: 'Great answer!', expected: 'positive' }
  ];

  for (let i = 0; i < testMessages.length; i++) {
    const msg = testMessages[i];
    const fb = feedbackTexts[i];

    const classification = await classifyAndStoreFeedback(
      msg.convId, msg.msgId, msg.userId, fb.text, {}
    );

    if (classification) {
      console.log(`  Classified: "${fb.text.substring(0, 30)}..." → ${classification.signal_type}`);

      await propagateFeedback(classification.feedback_id, classification.feedback_score, msg.msgId);
    }
  }

  // Calculate system health
  console.log('\n--- System Health Check ---');
  const health = await calculateSystemHealth();
  if (health) {
    console.log(`  Help rate: ${(health.help_rate * 100).toFixed(1)}%`);
    console.log(`  Status: ${health.status}`);
    console.log(`  Trend: ${health.trend}`);
  }

  // Run reinforcement learning
  console.log('\n--- Reinforcement Learning ---');
  const actions = await runReinforcementLearning();
  console.log(`  Actions: promote=${actions.promote}, maintain=${actions.maintain}, review=${actions.review}, deprioritize=${actions.deprioritize}`);

  // Summary
  console.log('\n--- Feedback Loop Summary ---');
  const { rows: summary } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM response_attributions WHERE created_at > NOW() - INTERVAL '1 hour') as recent_attributions,
      (SELECT COUNT(*) FROM user_feedback WHERE created_at > NOW() - INTERVAL '1 hour') as recent_feedback,
      (SELECT COUNT(*) FROM feedback_propagation WHERE created_at > NOW() - INTERVAL '1 hour') as recent_propagations,
      (SELECT AVG(outcome_score) FROM procedural_shards WHERE outcome_count > 0) as avg_outcome_score
  `);

  const s = summary[0];
  console.log(`  Recent attributions: ${s.recent_attributions}`);
  console.log(`  Recent feedback: ${s.recent_feedback}`);
  console.log(`  Recent propagations: ${s.recent_propagations}`);
  console.log(`  Avg outcome score: ${parseFloat(s.avg_outcome_score || 0.5).toFixed(3)}`);

  console.log('\n' + '═'.repeat(60));
  console.log('FEEDBACK LOOP COMPLETE');
  console.log('═'.repeat(60));

  await pool.end();
}

runFeedbackLoop().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
