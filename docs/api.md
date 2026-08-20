# OpenAI-compatible API

Create a scoped key in Pulpo and point an OpenAI SDK at your instance's `/v1` base URL.

```ts
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.PULPO_API_KEY,
  baseURL: 'https://pulpo.example.com/v1',
})

const response = await client.responses.create({
  model: 'your-pulpo-model-id',
  input: 'Hello from Pulpo',
})
```

## Endpoints

- `POST /v1/responses`
- `GET /v1/responses/:id`
- `POST /v1/responses/:id/cancel`
- `GET /v1/models`

Streaming uses standard Responses API server-sent events. Background requests return immediately and support retrieval and cancellation. Keys can be restricted by scope, model, monthly budget, and lifetime budget.

Never embed an administrative or provider credential in a client application. Create a Pulpo key with only the scopes and budgets the integration requires.
