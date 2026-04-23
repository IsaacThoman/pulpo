import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/v1/models", (c) =>
  c.json({
    object: "list",
    data: [
      {
        id: "mock-upstream-model",
        object: "model",
        created: 1,
        owned_by: "mock",
      },
      { id: "mock-ocr-model", object: "model", created: 1, owned_by: "mock" },
    ],
  }));

function extractPromptText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const typedItem = item as {
        type?: string;
        text?: string;
      };
      return typedItem.type === "text" ? typedItem.text || "" : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractResponsesPrompt(input: unknown): string {
  if (!Array.isArray(input)) {
    return "";
  }

  const lastItem = input[input.length - 1];
  if (!lastItem || typeof lastItem !== "object") {
    return "";
  }

  const content = (lastItem as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const typedItem = item as {
        type?: string;
        text?: string;
      };
      return typedItem.type === "input_text" ? typedItem.text || "" : "";
    })
    .filter(Boolean)
    .join("\n");
}

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();

  if (body.model === "mock-ocr-model") {
    return c.json({
      id: "chatcmpl-mock-ocr",
      object: "chat.completion",
      created: Date.now(),
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "MOCK OCR OUTPUT: scanned receipt total is 42.00 USD",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 9,
        total_tokens: 21,
      },
    });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastMessage = messages[messages.length - 1];
  const promptText = extractPromptText(lastMessage?.content);
  const responseText = `Echoed from upstream: ${promptText}`.trim();

  if (body.stream) {
    const stream = new ReadableStream({
      start(controller) {
        const chunks = [
          {
            id: "chatcmpl-stream",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: body.model,
            choices: [{
              index: 0,
              delta: { role: "assistant", content: "Echoed from upstream: " },
            }],
          },
          {
            id: "chatcmpl-stream",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: body.model,
            choices: [{ index: 0, delta: { content: promptText } }],
          },
          {
            id: "chatcmpl-stream",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: body.model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 120,
              prompt_tokens_details: {
                cached_tokens: 20,
              },
              completion_tokens: 45,
              total_tokens: 165,
            },
          },
        ];

        for (const chunk of chunks) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
          );
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  return c.json({
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Date.now(),
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: responseText,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 64,
      prompt_tokens_details: {
        cached_tokens: 8,
      },
      completion_tokens: 23,
      total_tokens: 87,
    },
  });
});

app.post("/v1/responses", async (c) => {
  const body = await c.req.json();
  const promptText = extractResponsesPrompt(body.input);
  const responseText = `Echoed from upstream: ${promptText}`.trim();

  if (body.stream) {
    const stream = new ReadableStream({
      start(controller) {
        const events = [
          {
            type: "response.created",
            response: {
              id: "resp-stream",
              object: "response",
              created_at: Math.floor(Date.now() / 1000),
            },
          },
          {
            type: "response.output_text.delta",
            delta: "Echoed from upstream: ",
          },
          {
            type: "response.output_text.delta",
            delta: promptText,
          },
          {
            type: "response.completed",
            response: {
              id: "resp-stream",
              object: "response",
              created_at: Math.floor(Date.now() / 1000),
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: responseText }],
                },
              ],
              usage: {
                input_tokens: 120,
                input_tokens_details: {
                  cached_tokens: 20,
                },
                output_tokens: 45,
                output_tokens_details: {
                  reasoning_tokens: 0,
                },
              },
            },
          },
        ];

        for (const event of events) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  return c.json({
    id: "resp-mock",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: responseText }],
      },
    ],
    usage: {
      input_tokens: 64,
      input_tokens_details: {
        cached_tokens: 8,
      },
      output_tokens: 23,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    },
  });
});

Deno.serve({ port: 4010 }, app.fetch);
