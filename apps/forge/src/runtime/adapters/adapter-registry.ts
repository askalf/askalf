/**
 * Adapter Registry
 *
 * Maps device types to their adapter implementations.
 * The task dispatcher queries this to find the right adapter for each device.
 */

import type { DeviceAdapter, DeviceType } from './device-adapter.js';
import { CliAdapter } from './cli-adapter.js';
import { DockerAdapter } from './docker-adapter.js';
import { SshAdapter } from './ssh-adapter.js';
import { K8sAdapter } from './k8s-adapter.js';
import { BrowserAdapter } from './browser-adapter.js';
import { DesktopAdapter } from './desktop-adapter.js';
import { VscodeAdapter } from './vscode-adapter.js';
import { MobileAdapter } from './mobile-adapter.js';
import { RpiAdapter } from './rpi-adapter.js';
import { ArduinoAdapter } from './arduino-adapter.js';
import { HomeAssistantAdapter } from './homeassistant-adapter.js';

const adapters = new Map<DeviceType, DeviceAdapter>();

function register(adapter: DeviceAdapter): void {
  adapters.set(adapter.type, adapter);
}

/** Initialize all adapters. Call once at startup. */
export function initAdapters(): void {
  if (adapters.size > 0) return;

  register(new CliAdapter());
  register(new DockerAdapter());
  register(new SshAdapter());
  register(new K8sAdapter());
  register(new BrowserAdapter());
  register(new DesktopAdapter());
  register(new VscodeAdapter());
  register(new MobileAdapter('android'));
  register(new MobileAdapter('ios'));
  register(new RpiAdapter());
  register(new ArduinoAdapter());
  register(new HomeAssistantAdapter());

  console.log(`[AdapterRegistry] ${adapters.size} device adapters registered`);
}

/** Get adapter for a device type. */
export function getAdapter(type: DeviceType): DeviceAdapter | undefined {
  return adapters.get(type);
}

/** Get all registered adapters. */
export function getAllAdapters(): DeviceAdapter[] {
  return Array.from(adapters.values());
}
