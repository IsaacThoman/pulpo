ALTER TABLE "ProxyModel"
ADD COLUMN "providerProtocol" TEXT NOT NULL DEFAULT 'chat_completions',
ADD COLUMN "reasoningSummaryMode" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN "reasoningOutputMode" TEXT NOT NULL DEFAULT 'off';
