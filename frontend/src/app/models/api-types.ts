export type SimModel = {
  id: string;
  displayName: string;
  description: string;
  isActive: boolean;
  exposeInModels: boolean;
  segments: SimSegment[];
  createdAt: string;
  updatedAt: string;
};

export type SimSegment =
  | { type: 'delay'; delayMs: number }
  | {
      type: 'text';
      content: string;
      ratePerSecond: number;
      unit: 'char' | 'token';
      maxUpdatesPerSecond: number;
    };

export type AdminUser = {
  id: string;
  username: string;
};

export type ProxyKey = {
  id: string;
  name: string;
  preview: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type ProxyModel = {
  id: string;
  displayName: string;
  description: string;
  providerId: string | null;
  providerName: string | null;
  usesCustomProvider: boolean;
  providerBaseUrl: string;
  upstreamModelName: string;
  providerProtocol: 'chat_completions' | 'responses';
  reasoningSummaryMode: 'off' | 'auto' | 'concise' | 'detailed';
  reasoningOutputMode: 'off' | 'think_tags' | 'reasoning_content';
  interceptImagesWithOcr: boolean;
  customParams: Record<string, unknown>;
  inputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  outputCostPerMillion: number;
  includeCostInUsage: boolean;
  isActive: boolean;
  hasProviderApiKey: boolean;
  // Fallback configuration
  fallbackModelId: string | null;
  fallbackModelName: string | null;
  maxRetries: number;
  fallbackDelaySeconds: number;
  stickyFallbackSeconds: number;
  firstTokenTimeoutEnabled: boolean;
  firstTokenTimeoutSeconds: number;
  slowStickyEnabled: boolean;
  slowStickyMinTokensPerSecond: number;
  slowStickyMinCompletionSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  modelCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LoggingSettings = {
  logPayloads: boolean;
};

export type OcrSettings = {
  enabled: boolean;
  providerId: string;
  providerBaseUrl: string;
  model: string;
  systemPrompt: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  apiKeyConfigured: boolean;
};

export type RefreshSettings = {
  enabled: boolean;
  intervalSeconds: number;
};

export type UsageSummary = {
  totals: {
    requests: number;
    successfulRequests: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
  byKey: Array<{
    keyId: string;
    name: string;
    requests: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byModel: Array<{
    modelId: string;
    name: string;
    requests: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  daily: Array<{
    day: string;
    requests: number;
    totalCost: number;
  }>;
  recent: Array<{
    id: string;
    requestType: string;
    success: boolean;
    statusCode: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalCost: number;
    errorMessage: string | null;
    createdAt: string;
    keyName: string | null;
    modelName: string | null;
    requestPayload: Record<string, unknown> | null;
    responsePayload: Record<string, unknown> | null;
    durationMs: number | null;
    // Fallback tracking
    isFallback: boolean;
    isStickyFallback: boolean;
    originalModelName: string | null;
    fallbackChain: string[];
    retryCount: number;
    isRetryAttempt: boolean;
  }>;
  recentPagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
