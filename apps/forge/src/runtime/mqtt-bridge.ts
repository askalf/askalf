/**
 * MQTT Bridge
 *
 * Manages connection to an MQTT broker for Arduino/ESP32 IoT devices.
 * Subscribes to device result/status topics, publishes task commands.
 * Optional — only initialized if MQTT_BROKER_URL is set.
 */

import { setMqttPublish, handleMqttResult } from './adapters/arduino-adapter.js';
import { updateHeartbeat } from './device-registry.js';
import { query } from '../database.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

/**
 * Initialize MQTT bridge. No-op if MQTT_BROKER_URL not set.
 */
export async function startMqttBridge(): Promise<void> {
  const brokerUrl = process.env['MQTT_BROKER_URL'];
  if (!brokerUrl) {
    console.log('[MqttBridge] MQTT_BROKER_URL not set — MQTT bridge disabled');
    return;
  }

  try {
    // Dynamic import to avoid requiring mqtt package when not used
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mqtt = await (import('mqtt' as any) as Promise<any>).catch(() => null);
    if (!mqtt) {
      console.log('[MqttBridge] mqtt package not installed — MQTT bridge disabled');
      return;
    }

    client = mqtt.connect(brokerUrl);

    client.on('connect', () => {
      console.log(`[MqttBridge] Connected to ${brokerUrl}`);
      client.subscribe('askalf/devices/+/results');
      client.subscribe('askalf/devices/+/status');
      client.subscribe('askalf/devices/+/sensors');
    });

    client.on('message', (topic: string, payload: Buffer) => {
      const parts = topic.split('/');
      if (parts.length !== 4 || parts[0] !== 'askalf' || parts[1] !== 'devices') return;

      const deviceId = parts[2]!;
      const channel = parts[3]!;
      const data = payload.toString();

      switch (channel) {
        case 'results':
          handleMqttResult(deviceId, data);
          break;
        case 'status':
          void handleDeviceStatus(deviceId, data).catch(() => {});
          break;
        case 'sensors':
          void handleSensorData(deviceId, data).catch(() => {});
          break;
      }
    });

    client.on('error', (err: unknown) => {
      console.error(`[MqttBridge] Error: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Provide publish function to Arduino adapter
    setMqttPublish((topic: string, payload: string) => {
      client?.publish(topic, payload);
    });

    console.log('[MqttBridge] MQTT bridge initialized');
  } catch (err) {
    console.error(`[MqttBridge] Failed to initialize:`, err);
  }
}

async function handleDeviceStatus(deviceId: string, payload: string): Promise<void> {
  try {
    const status = JSON.parse(payload) as Record<string, unknown>;
    await updateHeartbeat(deviceId, status, 0);
  } catch {
    // Invalid status payload
  }
}

async function handleSensorData(deviceId: string, payload: string): Promise<void> {
  try {
    const data = JSON.parse(payload);
    await query(
      `INSERT INTO agent_findings (id, category, severity, finding, agent_name, metadata)
       VALUES ($1, 'sensor_data', 'info', $2, 'iot_bridge', $3)`,
      [
        `sensor_${deviceId}_${Date.now()}`,
        `Sensor data from device ${deviceId}`,
        JSON.stringify({ deviceId, ...data }),
      ],
    );
  } catch {
    // Best effort sensor logging
  }
}

export function stopMqttBridge(): void {
  if (client) {
    client.end();
    client = null;
  }
}
