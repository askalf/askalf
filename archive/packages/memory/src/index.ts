// SUBSTRATE v1: 4-Tier Cognitive Memory System

// Re-export types for use by other packages
export type { TenantContext, Visibility, CommunityStatus } from './procedural/store.js';

// Tier 1: Procedural Memory (Logic Shards)
export * as procedural from './procedural/index.js';

// Tier 2: Episodic Memory (SAO Chains)
export * as episodic from './episodic/index.js';

// Tier 3: Semantic Memory (Truth Store)
export * as semantic from './semantic/index.js';

// Tier 4: Working Memory (Context Liquidation)
export * as working from './working/index.js';

// ALF Profile (Personal AI Assistant - per-user isolated)
export * as alf from './alf/index.js';

// Cognitive Checkpoint (Pre-action knowledge surfacing)
export * as checkpoint from './checkpoint/index.js';

// Active Memory Gathering (Auto-extracts user info from conversations)
export * as gather from './gather/index.js';

// Memory Integration (Bridges shards with all memory systems)
export * as integration from './integration/index.js';
