// SUBSTRATE v1: Metabolic Loop Engine
// Crystallize, Evolve, Promote, Decay, Learn

export * from './cycles/crystallize.js';
export * from './cycles/decay.js';
export * from './cycles/evolve.js';
export * from './cycles/promote.js';
export * from './cycles/lessons.js';
export * from './cycles/reseed.js';
export * from './cycles/recalibrate.js';
export * from './cycles/challenge.js';
export * from './cycles/classifier-seed.js';
export * from './cycles/feedback.js';

// Configuration
export interface MetabolicConfig {
  crystallizeSchedule: string;
  evolveSchedule: string;
  promoteSchedule: string;
  decaySchedule: string;
  challengeSchedule: string;
}

export const DEFAULT_METABOLIC_CONFIG: MetabolicConfig = {
  crystallizeSchedule: '*/15 * * * *',  // Every 15 minutes
  evolveSchedule: '0 * * * *',           // Every hour
  promoteSchedule: '*/30 * * * *',       // Every 30 minutes
  decaySchedule: '0 */12 * * *',         // Every 12 hours
  challengeSchedule: '0 3 * * *',        // Daily at 3 AM (nightly verification)
};
