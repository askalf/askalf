/**
 * Device Adapter Interface
 *
 * Standardizes how the task dispatcher routes work to any device type,
 * whether server-managed (Docker, SSH, K8s) or client-connecting (Browser, Mobile, IoT).
 */

export type DeviceType = 'cli' | 'docker' | 'ssh' | 'k8s' | 'browser' | 'desktop' | 'vscode' | 'android' | 'ios' | 'rpi' | 'arduino' | 'homeassistant';
export type DeviceCategory = 'compute' | 'browser' | 'mobile' | 'iot';
export type DeviceProtocol = 'websocket' | 'server-managed' | 'mqtt' | 'rest-poll';

export interface DeviceCapabilities {
  shell: boolean;
  filesystem: boolean;
  git: boolean;
  docker: boolean;
  node: boolean;
  python: boolean;
  browser: boolean;
  gui: boolean;
  gpio: boolean;
  camera: boolean;
  sensors: boolean;
  editor: boolean;
  adb: boolean;
  shortcuts: boolean;
  homeautomation: boolean;
  [key: string]: boolean;
}

export interface TaskExecution {
  executionId: string;
  agentId: string;
  agentName: string;
  input: string;
  maxTurns?: number;
  maxBudget?: number;
  systemPrompt?: string;
  modelId?: string;
}

export interface TaskResult {
  executionId: string;
  status: 'completed' | 'failed';
  output: string;
  error?: string;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  turns?: number;
}

export interface ConnectionConfig {
  // Docker
  socketPath?: string;
  dockerHost?: string;
  dockerPort?: number;
  defaultImage?: string;
  memoryLimit?: string;
  cpuLimit?: string;
  // SSH
  host?: string;
  port?: number;
  username?: string;
  privateKey?: string;
  privateKeyCredentialId?: string;
  jumpHost?: string;
  // Kubernetes
  kubeconfig?: string;
  kubeconfigCredentialId?: string;
  namespace?: string;
  serviceAccount?: string;
  image?: string;
  resourceLimits?: Record<string, string>;
  // MQTT (Arduino/ESP32)
  mqttBroker?: string;
  mqttTopic?: string;
  deviceSerial?: string;
  // Home Assistant
  haUrl?: string;
  haToken?: string;
  haTokenCredentialId?: string;
  entityPrefix?: string;
}

export interface DeviceAdapter {
  readonly type: DeviceType;
  readonly category: DeviceCategory;
  readonly protocol: DeviceProtocol;
  readonly maxConcurrency: number;

  /** Default capabilities for this device type */
  defaultCapabilities(): Partial<DeviceCapabilities>;

  /** Can this adapter handle the given task based on required capabilities? */
  canExecute(task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean;

  /** Dispatch a task to the device. Returns true if dispatched. */
  dispatch(deviceId: string, task: TaskExecution, config: ConnectionConfig): Promise<boolean>;

  /** Cancel a running task on the device. */
  cancel(deviceId: string, executionId: string, config: ConnectionConfig): Promise<boolean>;

  /** Test connectivity to the device. Returns status message. */
  testConnection(config: ConnectionConfig): Promise<{ ok: boolean; message: string }>;

  /** Clean up resources when device is removed. */
  cleanup(deviceId: string, config: ConnectionConfig): Promise<void>;
}
