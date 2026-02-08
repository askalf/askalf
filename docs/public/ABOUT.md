# Ask ALF - The Universal AI Platform

## What is Ask ALF?

Ask ALF is a universal AI platform that gives you access to every major AI model through a single interface. Instead of juggling multiple subscriptions, managing different API keys, and learning various interfaces, Ask ALF provides one unified experience.

## Key Features

### One Account, Every AI
- Access GPT-4, Claude, Gemini, Grok, and local models from one dashboard
- No vendor lock-in - switch models mid-conversation
- BYOK (Bring Your Own Keys) support with zero markup

### Perpetual Memory with Shards
- **Shards** are reusable response patterns that cost zero tokens
- When ALF recognizes a pattern it's seen before, it responds instantly from memory
- This saves money AND reduces environmental impact

### Environmental Sustainability
- Every shard response saves approximately:
  - 50ml of water per 100 tokens
  - 1 Wh of power
  - 0.5g of CO2
- Real-time tracking of your environmental contribution

### Privacy First
- Your conversations stay private
- BYOK users' API keys are encrypted at rest
- No model training on your data

## Pricing

| Plan | Price | Features |
|------|-------|----------|
| Free | $0/mo | 5 daily credits, basic models |
| Basic | $5/mo | 50 daily credits, API key access |
| Pro | $15/mo | 200 daily credits, BYOK, all models |
| Team | $49/mo | 500 credits, workspace features |
| Enterprise | Custom | Unlimited, dedicated support |

## How Shards Work

1. You ask ALF a question
2. ALF checks its shard library for matching patterns
3. If found: Instant response (0 tokens, 0 cost)
4. If not found: Routes to your preferred LLM
5. Successful responses may become new shards

## Getting Started

1. Visit [askalf.org](https://askalf.org)
2. Create an account or try the demo
3. Start chatting immediately
4. (Optional) Add your own API keys for unlimited access

## API Access

Developers can integrate ALF into their applications via REST API:

```bash
curl https://api.askalf.org/api/v1/chat \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the meaning of life?"}'
```

## Support

- Email: support@askalf.org
- Documentation: [docs.askalf.org](https://docs.askalf.org)
- GitHub: [github.com/askalf](https://github.com/askalf)

## Built With

- PostgreSQL + pgvector for semantic memory
- Redis for real-time events
- Node.js/TypeScript API
- React dashboard
- Cloudflare for security
