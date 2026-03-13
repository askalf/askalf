-- Add device type support to agent_devices
ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'cli'
  CHECK (device_type IN ('cli','docker','ssh','k8s','browser','desktop','vscode','android','ios','rpi','arduino','homeassistant'));
ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS device_category TEXT NOT NULL DEFAULT 'compute'
  CHECK (device_category IN ('compute','browser','mobile','iot'));
ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS connection_config JSONB NOT NULL DEFAULT '{}';
ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS max_concurrent_tasks INT NOT NULL DEFAULT 1;
ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'websocket'
  CHECK (protocol IN ('websocket','server-managed','mqtt','rest-poll'));

CREATE INDEX IF NOT EXISTS idx_agent_devices_device_type ON agent_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_agent_devices_device_category ON agent_devices(device_category);
