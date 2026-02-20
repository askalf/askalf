import { configureSandbox, execute as sandboxExecute, type ExecutionResult } from '@substrate/sandbox';

export interface ExecutionValidators {
  validateInput?: (input: unknown) => void | Promise<void>;
  validateOutput?: (output: unknown) => void | Promise<void>;
}

export interface ValidatedExecutionResult extends ExecutionResult {
  inputValidated: boolean;
  outputValidated: boolean;
}

/**
 * Execute shard logic with optional input/output validators.
 * - Fails fast if input validation throws
 * - Runs sandboxed execution
 * - Fails if output validation throws
 */
export async function executeShardWithValidation(
  logic: string,
  input: unknown,
  validators: ExecutionValidators = {},
  sandboxOptions?: Partial<Parameters<typeof configureSandbox>[0]>
): Promise<ValidatedExecutionResult> {
  if (sandboxOptions) {
    configureSandbox(sandboxOptions);
  }

  if (validators.validateInput) {
    await validators.validateInput(input);
  }

  const execResult = await sandboxExecute(logic, input);

  if (!execResult.success) {
    return { ...execResult, inputValidated: !!validators.validateInput, outputValidated: false };
  }

  if (validators.validateOutput) {
    await validators.validateOutput(execResult.output);
  }

  return { ...execResult, inputValidated: !!validators.validateInput, outputValidated: !!validators.validateOutput };
}