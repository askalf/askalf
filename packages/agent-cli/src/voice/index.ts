import { MicRecorder } from './recorder.js';
import { transcribe } from './transcriber.js';
import { isWhisperInstalled } from './setup.js';
import * as output from '../util/output.js';
import chalk from 'chalk';

export interface VoiceConfig {
  whisperModel: 'tiny' | 'base' | 'small' | 'medium';
  silenceThresholdDb: number;
  silenceDurationMs: number;
}

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  whisperModel: 'base',
  silenceThresholdDb: -40,
  silenceDurationMs: 1500,
};

export class VoiceInput {
  private recorder: MicRecorder;
  private config: VoiceConfig;

  constructor(config: Partial<VoiceConfig> = {}) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
    this.recorder = new MicRecorder({
      silenceThresholdDb: this.config.silenceThresholdDb,
      silenceDurationMs: this.config.silenceDurationMs,
    });
  }

  /**
   * Record from microphone, transcribe with whisper, return text.
   * Retries on empty transcription.
   */
  async listen(): Promise<string> {
    // Check whisper is installed
    const installed = await isWhisperInstalled();
    if (!installed) {
      output.error('Whisper is not installed. Run: askalf-agent voice-setup');
      throw new Error('Whisper not installed');
    }

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      console.log(chalk.cyan('🎤 Listening...'), chalk.dim('(press Enter to stop)'));

      const recording = await this.recorder.record();

      if (recording.buffer.length === 0 || recording.durationMs < 300) {
        output.warn("Didn't catch that — too short. Try again.");
        continue;
      }

      console.log(chalk.dim('Transcribing...'));

      try {
        const result = await transcribe(recording.buffer, this.config.whisperModel);

        if (!result.text || result.text.length < 2) {
          output.warn("Didn't catch that, try again.");
          continue;
        }

        // Show what was heard
        console.log(chalk.green('Heard:'), chalk.white(`"${result.text}"`));
        console.log(chalk.dim(`(${(recording.durationMs / 1000).toFixed(1)}s audio → ${result.durationMs}ms transcription)`));

        return result.text;
      } catch (err) {
        output.error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
        if (attempt < maxRetries - 1) {
          output.info('Try again...');
        }
      }
    }

    throw new Error('Voice input failed after multiple attempts');
  }

  cancel(): void {
    this.recorder.stop();
  }
}

export { isWhisperInstalled, setupWhisper, getWhisperPaths } from './setup.js';
