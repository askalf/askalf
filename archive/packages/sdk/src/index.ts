import { ids } from '@substrate/core';
import type {
  ProceduralShard,
  ShardExecution,
  ShardLifecycle,
  KnowledgeFact,
  Episode,
  WorkingContext,
  ReasoningTrace,
} from '@substrate/core';
import { initializePool, setPool } from '@substrate/database';
import type { DatabaseConfig, Pool } from '@substrate/database';
import { procedural, semantic, episodic, working, type TenantContext, type Visibility } from '@substrate/memory';
import * as metabolic from '@substrate/metabolic';
import {
  initializeAI,
  type AIConfig,
  generateEmbedding,
  generateEmbeddings,
  extractIntent,
  extractIntentWithValidation,
  synthesizeProcedureWithModel,
  synthesizeWithValidation,
  classifyIntent,
} from '@substrate/ai';
import {
  configureSandbox,
  execute as executeSandbox,
  cleanup as cleanupSandbox,
  validateLogic as validateSandboxLogic,
  type SandboxConfig,
} from '@substrate/sandbox';
import * as sigil from '@substrate/sigil';
import { createInMemoryProceduralStore } from './in-memory-procedural.js';
import { executeShardWithValidation, type ExecutionValidators, type ValidatedExecutionResult } from './validated-executor.js';

// Aggregate configuration for quick starts
export interface MetabolicSDKOptions {
  db?: DatabaseConfig;
  dbPool?: Pool;
  ai?: AIConfig;
  sandbox?: Partial<SandboxConfig>;
}

export interface MetabolicSDK {
  ids: typeof ids;
  memory: {
    procedural: typeof procedural;
    semantic: typeof semantic;
    episodic: typeof episodic;
    working: typeof working;
  };
  engine: {
    crystallize: typeof metabolic.crystallize;
    evolve: typeof metabolic.evolve;
    promote: typeof metabolic.promote;
    decay: typeof metabolic.decay;
    lessons: typeof metabolic.lessons;
    reseed: typeof metabolic.reseed;
  };
  ai: {
    initializeAI: typeof initializeAI;
    generateEmbedding: typeof generateEmbedding;
    generateEmbeddings: typeof generateEmbeddings;
    extractIntent: typeof extractIntent;
    extractIntentWithValidation: typeof extractIntentWithValidation;
    classifyIntent: typeof classifyIntent;
    synthesizeProcedureWithModel: typeof synthesizeProcedureWithModel;
    synthesizeWithValidation: typeof synthesizeWithValidation;
  };
  sandbox: {
    execute: typeof executeSandbox;
    configure: typeof configureSandbox;
    cleanup: typeof cleanupSandbox;
    validate: typeof validateSandboxLogic;
  };
  sigil: typeof sigil;
  stores: {
    createInMemoryProceduralStore: typeof createInMemoryProceduralStore;
  };
  validators: {
    executeShardWithValidation: typeof executeShardWithValidation;
  };
}

/**
 * Initialize core dependencies and return a curated SDK surface.
 * This avoids dragging the full Docker stack into developer integrations.
 */
export function createMetabolicSDK(options: MetabolicSDKOptions = {}): MetabolicSDK {
  const hasDb = Boolean(options.db || options.dbPool || process.env.DATABASE_URL);
  if (!hasDb) {
    throw new Error('Database configuration required (db, dbPool, or DATABASE_URL) for procedural store.');
  }

  if (options.dbPool) {
    setPool(options.dbPool);
  } else if (options.db) {
    initializePool(options.db);
  } else if (process.env.DATABASE_URL) {
    initializePool({ connectionString: process.env.DATABASE_URL });
  }

  if (options.ai) {
    initializeAI(options.ai);
  }

  if (options.sandbox) {
    configureSandbox(options.sandbox);
  }

  const sdk: MetabolicSDK = {
    ids,
    memory: {
      procedural,
      semantic,
      episodic,
      working,
    },
    engine: {
      crystallize: metabolic.crystallize,
      evolve: metabolic.evolve,
      promote: metabolic.promote,
      decay: metabolic.decay,
      lessons: metabolic.lessons,
      reseed: metabolic.reseed,
    },
    ai: {
      initializeAI,
      generateEmbedding,
      generateEmbeddings,
      extractIntent,
      extractIntentWithValidation,
      classifyIntent,
      synthesizeProcedureWithModel,
      synthesizeWithValidation,
    },
    sandbox: {
      execute: executeSandbox,
      configure: configureSandbox,
      cleanup: cleanupSandbox,
      validate: validateSandboxLogic,
    },
    sigil,
    stores: { createInMemoryProceduralStore },
    validators: { executeShardWithValidation },
  };

  return sdk;
}

// Re-export core primitives for direct imports
export {
  ids,
  procedural,
  semantic,
  episodic,
  working,
  metabolic,
  initializeAI,
  generateEmbedding,
  generateEmbeddings,
  extractIntent,
  extractIntentWithValidation,
  synthesizeProcedureWithModel,
  synthesizeWithValidation,
  classifyIntent,
  configureSandbox,
  executeSandbox,
  cleanupSandbox,
  validateSandboxLogic,
  sigil,
  createInMemoryProceduralStore,
  executeShardWithValidation,
};

export type {
  ProceduralShard,
  ShardExecution,
  ShardLifecycle,
  KnowledgeFact,
  Episode,
  WorkingContext,
  ReasoningTrace,
  TenantContext,
  Visibility,
  DatabaseConfig,
  Pool,
  AIConfig,
  SandboxConfig,
  MetabolicSDKOptions,
  MetabolicSDK,
  ExecutionValidators,
  ValidatedExecutionResult,
};