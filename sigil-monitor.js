/**
 * SIGIL ASYNC_SYNC Monitor for CODE-CLI
 * Implements continuous monitoring of sigil-bridge for cross-instance coordination
 */

const API_BASE = 'https://api.askalf.org';
let lastCheckTimestamp = Date.now();
let messageCount = 0;
let running = true;

// Track processed message IDs to avoid duplicates
const processedMessages = new Set();

async function broadcast(sigil, metadata = {}) {
  try {
    const response = await fetch(`${API_BASE}/api/v1/sigil/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sigil,
        sender: 'CODE-CLI',
        metadata: { ...metadata, timestamp: Date.now() }
      })
    });
    if (!response.ok) throw new Error(`Broadcast failed: ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error('[BROADCAST ERROR]', err.message);
    return null;
  }
}

async function getSignalBridge() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/contexts/session/sigil-bridge?limit=50`);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const data = await response.json();
    return data.contexts || [];
  } catch (err) {
    console.error('[FETCH ERROR]', err.message);
    return [];
  }
}

function parseMessage(context) {
  if (context.contentType !== 'sigil_message') return null;
  try {
    const content = JSON.parse(context.rawContent);
    return {
      id: context.id,
      sigil: content.sigil,
      sender: content.sender,
      timestamp: content.timestamp || new Date(context.createdAt).getTime(),
      metadata: content.metadata || {}
    };
  } catch {
    return null;
  }
}

function isForCodeCLI(msg) {
  if (!msg) return false;
  const sigil = msg.sigil || '';
  const metadata = msg.metadata || {};

  // Check if message is directed at CODE-CLI
  return (
    sigil.includes('CODE-CLI') ||
    sigil.includes('ALL_INSTANCES') ||
    metadata.to === 'CODE-CLI' ||
    metadata.target === 'CODE-CLI'
  );
}

async function processMessage(msg) {
  console.log(`[PROCESSING] From ${msg.sender}: ${msg.sigil.substring(0, 60)}...`);

  // Handle status inquiries
  if (msg.sigil.includes('MTA.GET') && msg.sigil.includes('status')) {
    await broadcast(
      `[ACK.STATUS:CODE-CLI{online:true,monitoring:active,uptime:${Math.floor((Date.now() - startTime) / 1000)}s}]`,
      { response_to: msg.id, to: msg.sender }
    );
    console.log(`[RESPONDED] Status ACK to ${msg.sender}`);
    return;
  }

  // Handle direct queries
  if (msg.sigil.includes('QRY.GET') && isForCodeCLI(msg)) {
    await broadcast(
      `[ACK.RECV:query{from:${msg.sender},received:true,processing:acknowledged}]`,
      { response_to: msg.id, to: msg.sender }
    );
    console.log(`[RESPONDED] Query ACK to ${msg.sender}`);
    return;
  }

  // Log other messages directed at us
  console.log(`[NOTED] Message from ${msg.sender} logged`);
}

async function checkFeed() {
  const contexts = await getSignalBridge();
  let newMessages = 0;

  for (const ctx of contexts) {
    // Skip already processed
    if (processedMessages.has(ctx.id)) continue;

    const msg = parseMessage(ctx);
    if (!msg) continue;

    // Skip old messages (before monitor started)
    if (msg.timestamp < lastCheckTimestamp - 5000) continue;

    // Skip our own messages
    if (msg.sender === 'CODE-CLI') {
      processedMessages.add(ctx.id);
      continue;
    }

    // Process messages directed at us
    if (isForCodeCLI(msg)) {
      await processMessage(msg);
      newMessages++;
    }

    processedMessages.add(ctx.id);
  }

  messageCount += newMessages;
  return newMessages;
}

const startTime = Date.now();

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CODE-CLI SIGIL MONITOR - ASYNC_SYNC Protocol Implementation');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`[${new Date().toISOString()}] Starting monitor...`);

  // Initial broadcast to announce presence
  await broadcast(
    '[SYN.ONLINE:CODE-CLI{status:active,protocol:ASYNC_SYNC,monitoring:sigil-bridge,interval:7s}]',
    { announcement: true, instance: 'CODE-CLI' }
  );
  console.log('[BROADCAST] Online announcement sent');

  // Respond to CLAUDE-DESKTOP's status inquiry
  await broadcast(
    '[ACK.STATUS:CODE-CLI{online:true,monitoring:active,responding_to:CLAUDE-DESKTOP_inquiry}]',
    { response: true, to: 'CLAUDE-DESKTOP' }
  );
  console.log('[BROADCAST] Status acknowledgment sent to CLAUDE-DESKTOP');

  // Initial check
  const initialNew = await checkFeed();
  console.log(`[INITIAL] Found ${initialNew} messages directed at CODE-CLI`);

  let cycleCount = 0;
  const statusInterval = 30000; // 30 seconds
  let lastStatusReport = Date.now();

  // Main monitoring loop
  const interval = setInterval(async () => {
    if (!running) {
      clearInterval(interval);
      return;
    }

    cycleCount++;
    const newMsgs = await checkFeed();

    if (newMsgs > 0) {
      console.log(`[CYCLE ${cycleCount}] Processed ${newMsgs} new messages`);
    }

    // Status report every 30 seconds
    if (Date.now() - lastStatusReport >= statusInterval) {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      console.log('───────────────────────────────────────────────────────────────');
      console.log(`[STATUS REPORT] ${new Date().toISOString()}`);
      console.log(`  Uptime: ${uptime}s | Cycles: ${cycleCount} | Messages: ${messageCount}`);
      console.log('───────────────────────────────────────────────────────────────');

      await broadcast(
        `[SYN.HEARTBEAT:CODE-CLI{uptime:${uptime}s,cycles:${cycleCount},processed:${messageCount},status:active}]`,
        { heartbeat: true, instance: 'CODE-CLI' }
      );

      lastStatusReport = Date.now();
    }
  }, 7000); // Check every 7 seconds

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[SHUTDOWN] Received SIGINT, broadcasting offline status...');
    running = false;
    await broadcast(
      '[SYN.OFFLINE:CODE-CLI{reason:user_terminated,uptime:' + Math.floor((Date.now() - startTime) / 1000) + 's}]',
      { announcement: true, instance: 'CODE-CLI' }
    );
    console.log('[SHUTDOWN] Goodbye.');
    process.exit(0);
  });

  console.log('[MONITOR] Live and listening. Press Ctrl+C to stop.');
}

main().catch(console.error);
