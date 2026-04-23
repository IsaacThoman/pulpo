import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import { cacheKeyForParts } from "../lib/security.ts";
import { logError, logInfo } from "../lib/logging.ts";
import { getOcrRuntimeSettings } from "./settings.ts";

type ChatMessage = {
  role: "developer" | "system" | "user" | "assistant";
  content: unknown;
};

function extractBase64FromDataUrl(dataUrl: string): string {
  const parts = dataUrl.split(",");
  if (parts.length !== 2) {
    throw new Error("Invalid image data URL");
  }

  return parts[1];
}

async function downloadImageFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith("image/")) {
    throw new Error(
      `Unsupported image content-type: ${contentType || "unknown"}`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return `data:${contentType};base64,${btoa(binary)}`;
}

function resolveImageDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:image/")) {
    return Promise.resolve(imageUrl);
  }

  return downloadImageFromUrl(imageUrl);
}

async function runOcr(
  prisma: PrismaClient,
  imageDataUrl: string,
): Promise<string> {
  const settings = await getOcrRuntimeSettings(prisma);
  if (!settings.enabled || !settings.apiKey) {
    logInfo("ocr.skipped", {
      enabled: settings.enabled,
      apiKeyConfigured: Boolean(settings.apiKey),
      providerBaseUrl: settings.providerBaseUrl,
      model: settings.model,
    });
    return "[OCR skipped because OCR is not configured.]";
  }

  const imageBase64 = extractBase64FromDataUrl(imageDataUrl);
  const approxImageBytes = Math.floor((imageBase64.length * 3) / 4);
  const cacheKey = await cacheKeyForParts([
    settings.providerBaseUrl,
    settings.model,
    settings.systemPrompt,
    imageBase64,
  ]);

  await prisma.ocrCacheEntry.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  if (settings.cacheEnabled) {
    const cached = await prisma.ocrCacheEntry.findUnique({
      where: { cacheKey },
    });

    if (cached && cached.expiresAt > new Date()) {
      logInfo("ocr.cache_hit", {
        providerBaseUrl: settings.providerBaseUrl,
        model: settings.model,
        cacheTtlSeconds: settings.cacheTtlSeconds,
        approxImageBytes,
      });
      return cached.extractedText;
    }
  }

  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.providerBaseUrl,
  });

  logInfo("ocr.request_start", {
    providerBaseUrl: settings.providerBaseUrl,
    model: settings.model,
    cacheEnabled: settings.cacheEnabled,
    cacheTtlSeconds: settings.cacheTtlSeconds,
    approxImageBytes,
    promptLength: settings.systemPrompt.length,
  });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: settings.model,
      stream: false,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: settings.systemPrompt,
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    });
  } catch (error) {
    logError("ocr.request_failed", error, {
      providerBaseUrl: settings.providerBaseUrl,
      model: settings.model,
      cacheEnabled: settings.cacheEnabled,
      approxImageBytes,
      promptLength: settings.systemPrompt.length,
    });
    throw error;
  }

  const content = completion.choices[0]?.message?.content || "";
  const extractedText = Array.isArray(content)
    ? content
      .map((part) => ("text" in part ? part.text || "" : ""))
      .join("\n")
      .trim()
    : String(content || "").trim();

  if (settings.cacheEnabled && extractedText) {
    await prisma.ocrCacheEntry.upsert({
      where: { cacheKey },
      update: {
        extractedText,
        expiresAt: new Date(Date.now() + settings.cacheTtlSeconds * 1000),
      },
      create: {
        cacheKey,
        extractedText,
        expiresAt: new Date(Date.now() + settings.cacheTtlSeconds * 1000),
      },
    });
  }

  logInfo("ocr.request_success", {
    providerBaseUrl: settings.providerBaseUrl,
    model: settings.model,
    extractedLength: extractedText.length,
    cacheEnabled: settings.cacheEnabled,
  });

  return extractedText;
}

async function processContent(
  prisma: PrismaClient,
  content: unknown,
): Promise<unknown> {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const typedItem = item as {
      type?: string;
      text?: string;
      image_url?: { url?: string };
    };

    if (typedItem.type === "text" && typedItem.text) {
      parts.push(typedItem.text);
      continue;
    }

    if (typedItem.type === "image_url" && typedItem.image_url?.url) {
      try {
        const dataUrl = await resolveImageDataUrl(typedItem.image_url.url);
        const extracted = await runOcr(prisma, dataUrl);
        parts.push(
          `[Image context follows. Treat this as direct visual context and do not mention OCR unless asked.\n${extracted}]`,
        );
      } catch (error) {
        logError("ocr.message_processing_failed", error, {
          imageUrlPreview: typedItem.image_url.url.slice(0, 120),
        });
        parts.push(
          `[Image OCR failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }]`,
        );
      }
    }
  }

  return parts.join("\n").trim();
}

export function applyOcrToMessages(
  prisma: PrismaClient,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      content: await processContent(prisma, message.content),
    })),
  );
}
