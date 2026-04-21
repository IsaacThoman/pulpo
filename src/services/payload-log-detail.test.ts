import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import {
  buildSummaryResponsePayload,
  hasDetailedPayloads,
  hasDetailedResponsePayload,
} from './payload-log-detail.ts';

Deno.test('buildSummaryResponsePayload keeps only non-sensitive response metadata', () => {
  assertEquals(
    buildSummaryResponsePayload({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 123,
      model: 'test-model',
      choices: [{ message: { role: 'assistant', content: 'secret' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
    {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 123,
      model: 'test-model',
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    },
  );
});

Deno.test('hasDetailedResponsePayload ignores summary-only payloads', () => {
  assertEquals(
    hasDetailedResponsePayload({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
    false,
  );
});

Deno.test('hasDetailedPayloads detects stored request bodies and rich responses', () => {
  assertEquals(
    hasDetailedPayloads({
      requestPayload: { messages: [{ role: 'user', content: 'secret' }] },
      responsePayload: null,
    }),
    true,
  );
  assertEquals(
    hasDetailedPayloads({
      requestPayload: null,
      responsePayload: {
        assistantText: 'secret answer',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
    }),
    true,
  );
  assertEquals(
    hasDetailedPayloads({
      requestPayload: null,
      responsePayload: {
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
    }),
    false,
  );
});
