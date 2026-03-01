# @askalf/agent

**Open source computer-use agent.** Control your entire computer with natural language — or your voice.

Uses your existing Claude subscription. Zero extra API costs. PowerShell-first. Interactive sessions.

## Install

```bash
npm i -g @askalf/agent
```

## Quick Start

```bash
# 1. Authenticate
askalf-agent auth

# 2. Run a task
askalf-agent run "open chrome and go to github.com"

# 3. Voice mode — talk to your computer
askalf-agent voice-setup          # one-time: downloads whisper.cpp
askalf-agent run "open notepad" --voice
```

## Voice Control

Speak commands instead of typing. Uses local [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for speech-to-text — free, private, completely offline.

```bash
# Set up whisper (one-time, downloads ~148MB model)
askalf-agent voice-setup
askalf-agent voice-setup --model tiny    # smaller/faster model (~75MB)
askalf-agent voice-setup --model small   # more accurate (~466MB)

# Run with voice
askalf-agent run "your initial task" --voice
```

**How it works:**
1. Agent completes your task, asks "What next?"
2. Microphone records your voice (16kHz mono)
3. Silence detection stops recording after 1.5s quiet (or press Enter)
4. whisper.cpp transcribes locally — no cloud, no API calls
5. Transcribed text feeds into the existing command loop

**Platform requirements:**
| OS | Audio capture | Extra install |
|----|--------------|---------------|
| Windows | SoX (bundled) | None |
| macOS | SoX | `brew install sox` |
| Linux | arecord (ALSA) | Pre-installed |

## Features

- **PowerShell-First** — No slow screenshot loops. Commands execute directly
- **Voice Control** — Speak commands via local whisper.cpp (offline, private)
- **Browse the Web** — Opens Chrome, navigates sites, fills forms
- **Manage Files** — Create, move, read, edit files anywhere
- **Run Anything** — Git, npm, Docker, Python — full shell access
- **See Your Screen** — Screenshot tool for visual verification
- **Interactive Loop** — "What next?" persistent sessions

## Auth Modes

| Mode | How | Cost |
|------|-----|------|
| **OAuth** (recommended) | `askalf-agent auth` → sign in with Claude | Included in Claude Pro/Max |
| **API Key** | `askalf-agent auth` → paste `sk-ant-*` key | Pay-per-token |

## Commands

```bash
askalf-agent auth              # Configure authentication
askalf-agent auth --status     # Check auth status
askalf-agent run <prompt>      # Run agent with task
askalf-agent run <prompt> -v   # Run with voice input
askalf-agent voice-setup       # Download whisper for voice control
askalf-agent check             # Check platform dependencies
askalf-agent config            # View/update configuration
```

## Configuration

Stored in `~/.askalf/config.json`:

```json
{
  "authMode": "oauth",
  "model": "claude-sonnet-4-6",
  "maxBudgetUsd": 5.0,
  "maxTurns": 50,
  "voice": {
    "whisperModel": "base",
    "silenceThresholdDb": -40,
    "silenceDurationMs": 1500
  }
}
```

## Requirements

- Node.js 20+
- Claude Pro or Max subscription (OAuth) or Anthropic API key
- For voice: SoX (Windows/macOS) or arecord (Linux)

## License

MIT
