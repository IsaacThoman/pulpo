import { animate, state, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, type OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  LoggingSettings,
  OcrSettings,
  Provider,
  ProxyKey,
  ProxyModel,
  RefreshSettings,
  SimModel,
  SimSegment,
  UsageSummary,
} from '../models/api-types';
import { ApiService } from '../services/api.service';

type TabId =
  | 'overview'
  | 'keys'
  | 'providers'
  | 'models'
  | 'ocr'
  | 'usage'
  | 'playground'
  | 'settings'
  | 'simulations';

type SimSegmentDraft =
  | { type: 'delay'; delayMs: number }
  | {
      type: 'text';
      content: string;
      ratePerSecond: number;
      unit: 'char' | 'token';
      maxUpdatesPerSecond: number;
    };

type SimModelDraft = {
  displayName: string;
  description: string;
  isActive: boolean;
  exposeInModels: boolean;
  segments: SimSegmentDraft[];
};

type Attachment = {
  kind: 'image' | 'text';
  name: string;
  payload: string;
};

type TranscriptMessage = {
  role: 'system' | 'user' | 'assistant';
  text: string;
  reasoningText?: string;
};

type ModelDraft = {
  displayName: string;
  description: string;
  providerId: string;
  providerBaseUrl: string;
  providerApiKey: string;
  upstreamModelName: string;
  providerProtocol: 'chat_completions' | 'responses';
  reasoningSummaryMode: 'off' | 'auto' | 'concise' | 'detailed';
  reasoningOutputMode: 'off' | 'think_tags' | 'reasoning_content';
  interceptImagesWithOcr: boolean;
  customParams: string;
  inputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  outputCostPerMillion: number;
  includeCostInUsage: boolean;
  isActive: boolean;
  // Fallback configuration
  fallbackEnabled: boolean;
  fallbackModelId: string;
  maxRetries: number;
  fallbackDelaySeconds: number;
  stickyFallbackSeconds: number;
  firstTokenTimeoutEnabled: boolean;
  firstTokenTimeoutSeconds: number;
  slowStickyEnabled: boolean;
  slowStickyMinTokensPerSecond: number;
  slowStickyMinCompletionSeconds: number;
};

type ProviderDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
};

type PayloadRetentionOption = {
  value: LoggingSettings['payloadRetention'];
  label: string;
};

function createEmptyModelDraft(): ModelDraft {
  return {
    displayName: '',
    description: '',
    providerId: '',
    providerBaseUrl: 'https://api.openai.com/v1',
    providerApiKey: '',
    upstreamModelName: '',
    providerProtocol: 'responses',
    reasoningSummaryMode: 'off',
    reasoningOutputMode: 'off',
    interceptImagesWithOcr: false,
    customParams: '{}',
    inputCostPerMillion: 0,
    cachedInputCostPerMillion: 0,
    outputCostPerMillion: 0,
    includeCostInUsage: false,
    isActive: true,
    // Fallback defaults
    fallbackEnabled: false,
    fallbackModelId: '', // empty means same model (retry on current)
    maxRetries: 1,
    fallbackDelaySeconds: 3,
    stickyFallbackSeconds: 0,
    firstTokenTimeoutEnabled: false,
    firstTokenTimeoutSeconds: 10,
    slowStickyEnabled: false,
    slowStickyMinTokensPerSecond: 5,
    slowStickyMinCompletionSeconds: 30,
  };
}

function createEmptyProviderDraft(): ProviderDraft {
  return {
    name: '',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
  };
}

function createEmptySimModelDraft(): SimModelDraft {
  return {
    displayName: '',
    description: '',
    isActive: true,
    exposeInModels: false,
    segments: [],
  };
}

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-page.component.html',
  animations: [
    trigger('expandCollapse', [
      state(
        'collapsed',
        style({
          height: '0',
          opacity: '0',
          overflow: 'hidden',
        }),
      ),
      state(
        'expanded',
        style({
          height: '*',
          opacity: '1',
        }),
      ),
      transition('collapsed <=> expanded', [animate('200ms ease-out')]),
    ]),
  ],
})
export class AdminPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private pointerDownTarget: EventTarget | null = null;

  // UI State
  adminUsername = '';
  activeTab: TabId = 'overview';
  loading = false;
  notice = '';
  error = '';
  noticeHiding = false;
  errorHiding = false;
  mobileMenuOpen = false;

  // Data
  proxyKeys: ProxyKey[] = [];
  providers: Provider[] = [];
  proxyModels: ProxyModel[] = [];
  simModels: SimModel[] = [];
  usage: UsageSummary | null = null;

  // Keys
  newKeyName = '';
  newKeyActive = true;
  showKeyModal = false;

  // Key editing
  editingKeyId = '';
  keyEditDraft = {
    name: '',
    isActive: true,
  };
  showKeyEditModal = false;

  // Key visibility state - stores full keys and visibility toggle
  keyStorage: Map<string, string> = new Map(); // keyId -> fullKey
  visibleKeys: Set<string> = new Set(); // keyIds that are currently visible

  // Models
  editingModelId = '';
  modelDraft = createEmptyModelDraft();
  providerModelNames: string[] = [];
  showModelModal = false;
  showUpstreamDropdown = false;
  upstreamFilter = '';

  // Providers
  editingProviderId = '';
  providerDraft = createEmptyProviderDraft();
  showProviderModal = false;
  providerKeyStorage: Map<string, string> = new Map(); // providerId/custom:modelId -> providerApiKey
  visibleProviderKeys: Set<string> = new Set(); // providerIds/custom:modelIds with visible provider keys

  // SimModels
  editingSimModelId = '';
  simModelDraft = createEmptySimModelDraft();
  showSimModelModal = false;

  // Settings
  readonly payloadRetentionOptions: PayloadRetentionOption[] = [
    { value: '1_hour', label: '1 hour' },
    { value: '24_hours', label: '24 hours' },
    { value: '7_days', label: '7 days' },
    { value: '30_days', label: '30 days' },
    { value: '90_days', label: '90 days' },
    { value: 'indefinite', label: 'Indefinite' },
  ];
  loggingDraft: LoggingSettings = {
    logPayloads: false,
    payloadRetention: '7_days',
  };
  loggingDraftDirty = false;
  usageDays = 30;
  usageRecentPage = 1;
  readonly usageRecentPageSize = 50;
  expandedRequestId: string | null = null;

  ocrDraft: OcrSettings = {
    enabled: false,
    providerId: '',
    providerBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    systemPrompt: '',
    cacheEnabled: true,
    cacheTtlSeconds: 3600,
    apiKeyConfigured: false,
  };
  ocrDraftDirty = false;
  ocrApiKey = '';

  // Settings - Auto-refresh
  refreshDraft: RefreshSettings = {
    enabled: true,
    intervalSeconds: 30,
  };
  refreshDraftDirty = false;
  showMigrationModal = false;
  migrationIncludeUsageHistory = false;
  migrationBusy = false;
  migrationSelectedFileName = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  lastRefreshFailed = false;

  // Toast auto-dismiss timers
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  // Playground
  playgroundModelId = '';
  playgroundSystemPrompt = '';
  playgroundPrompt = '';
  playgroundStream = true;
  playgroundBusy = false;
  attachments: Attachment[] = [];
  transcript: TranscriptMessage[] = [];

  constructor() {
    // Subscribe to route param changes to update active tab
    this.route.params.subscribe((params) => {
      const tab = params['tab'] as TabId;
      if (
        tab &&
        [
          'overview',
          'keys',
          'providers',
          'models',
          'ocr',
          'usage',
          'playground',
          'settings',
          'simulations',
        ].includes(tab)
      ) {
        this.activeTab = tab;
      }
    });
    void this.initialize();
  }

  // Navigation helper for template
  navigateToTab(tab: TabId): void {
    this.mobileMenuOpen = false;
    void this.router.navigate(['/admin', tab]);
  }

  // Mobile menu helpers
  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
  }

  // Keyboard shortcuts
  @HostListener('document:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.showUpstreamDropdown) {
      this.showUpstreamDropdown = false;
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= 9) {
        event.preventDefault();
        const tabs: TabId[] = [
          'overview',
          'keys',
          'providers',
          'models',
          'ocr',
          'usage',
          'playground',
          'settings',
          'simulations',
        ];
        const tab = tabs[num - 1];
        void this.router.navigate(['/admin', tab]);
      }
    }
    if (event.key === 'Escape') {
      this.showKeyModal = false;
      this.showKeyEditModal = false;
      this.showProviderModal = false;
      this.showModelModal = false;
      this.showSimModelModal = false;
      this.showMigrationModal = false;
      this.mobileMenuOpen = false;
    }
  }

  @HostListener('document:mousedown', ['$event'])
  handlePointerDown(event: MouseEvent): void {
    this.pointerDownTarget = event.target;
  }

  @HostListener('document:click', ['$event'])
  handleClickOutside(event: MouseEvent): void {
    // Close upstream dropdown when clicking outside
    if (this.showUpstreamDropdown) {
      const target = event.target as HTMLElement;
      const pointerDownTarget =
        this.pointerDownTarget instanceof HTMLElement ? this.pointerDownTarget : null;
      const isInsideDropdown = target.closest('.upstream-dropdown-shell') !== null;
      const pointerDownInsideDropdown =
        pointerDownTarget?.closest('.upstream-dropdown-shell') !== null;
      if (!isInsideDropdown && !pointerDownInsideDropdown) {
        this.showUpstreamDropdown = false;
      }
    }
  }

  closeModalFromOverlay(
    event: MouseEvent,
    modal: 'key' | 'keyEdit' | 'provider' | 'model' | 'simModel' | 'migration',
  ): void {
    if (event.target !== event.currentTarget || this.pointerDownTarget !== event.currentTarget) {
      return;
    }

    switch (modal) {
      case 'key':
        this.showKeyModal = false;
        break;
      case 'keyEdit':
        this.showKeyEditModal = false;
        break;
      case 'provider':
        this.showProviderModal = false;
        break;
      case 'model':
        this.showModelModal = false;
        break;
      case 'simModel':
        this.showSimModelModal = false;
        break;
      case 'migration':
        this.showMigrationModal = false;
        break;
    }
  }

  // Toast helpers with auto-dismiss
  showNotice(message: string): void {
    this.noticeHiding = false;
    this.notice = message;
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
    if (message) {
      console.info('[toast:success]', message);
      this.noticeTimer = setTimeout(() => {
        this.hideNotice();
      }, 2000);
    }
  }

  private hideNotice(): void {
    this.noticeHiding = true;
    setTimeout(() => {
      this.notice = '';
      this.noticeHiding = false;
    }, 150);
  }

  showError(message: string): void {
    this.errorHiding = false;
    this.error = message;
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }
    if (message) {
      console.error('[toast:error]', message);
      this.errorTimer = setTimeout(() => {
        this.hideError();
      }, 2000);
    }
  }

  private hideError(): void {
    this.errorHiding = true;
    setTimeout(() => {
      this.error = '';
      this.errorHiding = false;
    }, 150);
  }

  clearNotice(): void {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
    this.hideNotice();
  }

  clearError(): void {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }
    this.hideError();
  }

  async initialize(): Promise<void> {
    try {
      const me = await this.api.getMe();
      if (!me.admin) {
        await this.router.navigateByUrl('/login');
        return;
      }
      this.adminUsername = me.admin.username;
      await this.refreshAll();
      this.startAutoRefresh();
    } catch {
      await this.router.navigateByUrl('/login');
    }
  }

  async refreshAll(): Promise<void> {
    this.loading = true;
    this.showError('');
    try {
      const [keys, providers, models, simModels, usage, logging, ocr, refresh] = await Promise.all([
        this.api.listProxyKeys(),
        this.api.listProviders(),
        this.api.listModels(),
        this.api.listSimModels(),
        this.api.getUsageSummary(this.usageDays, this.usageRecentPage, this.usageRecentPageSize),
        this.api.getLoggingSettings(),
        this.api.getOcrSettings(),
        this.api.getRefreshSettings(),
      ]);
      this.proxyKeys = keys.items;
      this.providers = providers.items;
      this.proxyModels = models.items;
      this.simModels = simModels.items;
      this.usage = usage;
      this.usageRecentPage = usage.recentPagination.page;
      // Only update drafts if they don't have unsaved changes
      if (!this.loggingDraftDirty) {
        this.loggingDraft = logging;
      }
      if (!this.ocrDraftDirty) {
        this.ocrDraft = ocr;
      }
      if (!this.refreshDraftDirty) {
        this.refreshDraft = refresh;
      }
      this.lastRefreshFailed = false;
      if (!this.playgroundModelId && this.proxyModels[0]) {
        this.playgroundModelId = this.proxyModels[0].id;
      }
    } catch (err) {
      this.lastRefreshFailed = true;
      this.showError(this.normalizeError(err));
    } finally {
      this.loading = false;
    }
  }

  async refreshUsage(): Promise<void> {
    try {
      this.usage = await this.api.getUsageSummary(
        this.usageDays,
        this.usageRecentPage,
        this.usageRecentPageSize,
      );
      this.usageRecentPage = this.usage.recentPagination.page;
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async onUsageDaysChange(): Promise<void> {
    this.usageRecentPage = 1;
    this.expandedRequestId = null;
    await this.refreshUsage();
  }

  async logout(): Promise<void> {
    await this.api.logout();
    await this.router.navigateByUrl('/login');
  }

  // Keys
  async createKey(): Promise<void> {
    try {
      const response = await this.api.createProxyKey({
        name: this.newKeyName,
        isActive: this.newKeyActive,
      });
      // Store the full key and auto-show it
      this.keyStorage.set(response.item.id, response.plainTextKey);
      this.visibleKeys.add(response.item.id);
      this.newKeyName = '';
      this.showKeyModal = false;
      await this.refreshAll();
      this.showNotice('Key created and revealed (click Hide to mask)');
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async toggleKey(key: ProxyKey): Promise<void> {
    try {
      await this.api.updateProxyKey(key.id, { isActive: !key.isActive });
      await this.refreshAll();
      this.showNotice(`Key ${key.isActive ? 'disabled' : 'enabled'}`);
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async rotateKey(key: ProxyKey): Promise<void> {
    try {
      const response = await this.api.rotateProxyKey(key.id);
      // Store the new full key and auto-show it
      this.keyStorage.set(key.id, response.plainTextKey);
      this.visibleKeys.add(key.id);
      await this.refreshAll();
      this.showNotice(`Key rotated and revealed: ${key.name}`);
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async deleteKey(key: ProxyKey): Promise<void> {
    if (!confirm(`Delete key "${key.name}"?`)) return;
    try {
      await this.api.deleteProxyKey(key.id);
      this.keyStorage.delete(key.id);
      this.visibleKeys.delete(key.id);
      await this.refreshAll();
      this.showNotice(`Key deleted: ${key.name}`);
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  // Key editing
  openKeyEditModal(key: ProxyKey): void {
    this.editingKeyId = key.id;
    this.keyEditDraft = {
      name: key.name,
      isActive: key.isActive,
    };
    this.showKeyEditModal = true;
  }

  closeKeyEditModal(): void {
    this.showKeyEditModal = false;
    this.editingKeyId = '';
    this.keyEditDraft = { name: '', isActive: true };
  }

  async saveKeyEdit(): Promise<void> {
    if (!this.editingKeyId) return;
    try {
      const key = this.proxyKeys.find((k) => k.id === this.editingKeyId);
      if (!key) return;

      // Only update if name changed
      if (this.keyEditDraft.name !== key.name) {
        await this.api.updateProxyKey(this.editingKeyId, { name: this.keyEditDraft.name });
      }

      // Handle status change
      if (this.keyEditDraft.isActive !== key.isActive) {
        await this.api.updateProxyKey(this.editingKeyId, { isActive: this.keyEditDraft.isActive });
      }

      this.showKeyEditModal = false;
      this.editingKeyId = '';
      this.keyEditDraft = { name: '', isActive: true };
      await this.refreshAll();
      this.showNotice('Key updated');
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async rotateKeyFromEdit(): Promise<void> {
    if (!this.editingKeyId) return;
    const key = this.proxyKeys.find((k) => k.id === this.editingKeyId);
    if (!key) return;
    await this.rotateKey(key);
  }

  getEditingKey(): ProxyKey | undefined {
    return this.proxyKeys.find((k) => k.id === this.editingKeyId);
  }

  // Key visibility helpers
  getKeyDisplay(key: ProxyKey): string {
    const fullKey = this.keyStorage.get(key.id);
    if (!fullKey) return key.preview; // fallback to preview if we don't have it
    if (this.visibleKeys.has(key.id)) return fullKey;
    return '•'.repeat(Math.min(fullKey.length, 32));
  }

  getKeyTooltip(key: ProxyKey): string {
    return this.keyStorage.get(key.id) || key.preview;
  }

  hasFullKey(key: ProxyKey): boolean {
    return this.keyStorage.has(key.id);
  }

  isKeyVisible(key: ProxyKey): boolean {
    return this.visibleKeys.has(key.id);
  }

  toggleKeyVisibility(key: ProxyKey): void {
    if (this.visibleKeys.has(key.id)) {
      this.visibleKeys.delete(key.id);
    } else {
      this.visibleKeys.add(key.id);
    }
  }

  toggleRequestExpansion(requestId: string): void {
    if (this.expandedRequestId === requestId) {
      this.expandedRequestId = null;
    } else {
      this.expandedRequestId = requestId;
    }
  }

  isRequestExpanded(requestId: string): boolean {
    return this.expandedRequestId === requestId;
  }

  trackByRequestId(index: number, item: { id: string }): string {
    return item.id;
  }

  async goToUsageRecentPage(page: number): Promise<void> {
    const totalPages = this.usage?.recentPagination.totalPages ?? 1;
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    if (nextPage === this.usageRecentPage) {
      return;
    }
    this.usageRecentPage = nextPage;
    this.expandedRequestId = null;
    await this.refreshUsage();
  }

  usageRecentRangeStart(): number {
    const pagination = this.usage?.recentPagination;
    if (!pagination || pagination.totalItems === 0) {
      return 0;
    }
    return (pagination.page - 1) * pagination.pageSize + 1;
  }

  usageRecentRangeEnd(): number {
    const pagination = this.usage?.recentPagination;
    if (!pagination || pagination.totalItems === 0) {
      return 0;
    }
    return Math.min(pagination.page * pagination.pageSize, pagination.totalItems);
  }

  async copyKey(key: ProxyKey): Promise<void> {
    const fullKey = this.keyStorage.get(key.id);
    if (!fullKey) return;
    try {
      await navigator.clipboard.writeText(fullKey);
      this.showNotice('Key copied to clipboard');
    } catch {
      this.showError('Failed to copy');
    }
  }

  // Providers
  openProviderModal(): void {
    this.editingProviderId = '';
    this.providerDraft = createEmptyProviderDraft();
    this.showProviderModal = true;
  }

  editProvider(provider: Provider): void {
    this.editingProviderId = provider.id;
    this.providerDraft = {
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: this.providerKeyStorage.get(provider.id) || '',
    };
    if (provider.hasApiKey && !this.providerKeyStorage.has(provider.id)) {
      void this.fetchProviderApiKey(provider.id);
    }
    this.showProviderModal = true;
  }

  async fetchProviderApiKey(providerId: string): Promise<void> {
    try {
      const response = await this.api.getProviderApiKey(providerId);
      if (response.key) {
        this.providerKeyStorage.set(providerId, response.key);
        if (this.editingProviderId === providerId) {
          this.providerDraft.apiKey = response.key;
        }
      }
    } catch (err) {
      console.error('Failed to fetch provider key:', err);
    }
  }

  async saveProvider(): Promise<void> {
    try {
      const payload = { ...this.providerDraft };
      if (this.editingProviderId) {
        await this.api.updateProvider(this.editingProviderId, payload);
        if (this.providerDraft.apiKey) {
          this.providerKeyStorage.set(this.editingProviderId, this.providerDraft.apiKey);
        }
        this.showNotice('Provider updated');
      } else {
        const response = await this.api.createProvider(payload);
        if (this.providerDraft.apiKey && response.item.id) {
          this.providerKeyStorage.set(response.item.id, this.providerDraft.apiKey);
        }
        this.showNotice('Provider created');
      }
      this.showProviderModal = false;
      this.resetProviderDraft();
      await this.refreshAll();
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async deleteProvider(provider: Provider): Promise<void> {
    if (!confirm(`Delete provider "${provider.name}"?`)) return;
    try {
      await this.api.deleteProvider(provider.id);
      this.providerKeyStorage.delete(provider.id);
      this.visibleProviderKeys.delete(provider.id);
      await this.refreshAll();
      this.showNotice(`Provider deleted: ${provider.name}`);
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  resetProviderDraft(): void {
    this.editingProviderId = '';
    this.providerDraft = createEmptyProviderDraft();
  }

  // Models
  openModelModal(): void {
    this.editingModelId = '';
    this.modelDraft = createEmptyModelDraft();
    if (this.providers[0]) {
      this.modelDraft.providerId = this.providers[0].id;
      this.modelDraft.providerBaseUrl = this.providers[0].baseUrl;
    }
    this.showUpstreamDropdown = false;
    this.upstreamFilter = '';
    this.providerModelNames = [];
    this.showModelModal = true;
  }

  editModel(model: ProxyModel): void {
    this.editingModelId = model.id;
    const isRetryEnabled = (model.maxRetries ?? 0) > 0;
    this.modelDraft = {
      displayName: model.displayName,
      description: model.description || '',
      providerId: model.providerId || '',
      providerBaseUrl: model.providerBaseUrl,
      providerApiKey: this.providerKeyStorage.get(this.getModelProviderKeyId(model.id)) || '',
      upstreamModelName: model.upstreamModelName,
      providerProtocol: model.providerProtocol,
      reasoningSummaryMode: model.reasoningSummaryMode,
      reasoningOutputMode: model.reasoningOutputMode,
      interceptImagesWithOcr: model.interceptImagesWithOcr,
      customParams: JSON.stringify(model.customParams || {}, null, 2),
      inputCostPerMillion: model.inputCostPerMillion,
      cachedInputCostPerMillion: model.cachedInputCostPerMillion,
      outputCostPerMillion: model.outputCostPerMillion,
      includeCostInUsage: model.includeCostInUsage,
      isActive: model.isActive,
      // Fallback configuration
      fallbackEnabled: isRetryEnabled,
      fallbackModelId: model.fallbackModelId || '', // empty means same model
      maxRetries: model.maxRetries ?? 1,
      fallbackDelaySeconds: model.fallbackDelaySeconds ?? 3,
      stickyFallbackSeconds: model.stickyFallbackSeconds ?? 0,
      firstTokenTimeoutEnabled: model.firstTokenTimeoutEnabled ?? false,
      firstTokenTimeoutSeconds: model.firstTokenTimeoutSeconds ?? 10,
      slowStickyEnabled: model.slowStickyEnabled ?? false,
      slowStickyMinTokensPerSecond: model.slowStickyMinTokensPerSecond ?? 5,
      slowStickyMinCompletionSeconds: model.slowStickyMinCompletionSeconds ?? 30,
    };
    if (
      model.hasProviderApiKey &&
      model.usesCustomProvider &&
      !this.providerKeyStorage.has(this.getModelProviderKeyId(model.id))
    ) {
      void this.fetchProviderKey(model.id);
    }
    if (model.providerId) {
      const selectedProvider = this.providers.find((provider) => provider.id === model.providerId);
      if (selectedProvider) {
        this.modelDraft.providerBaseUrl = selectedProvider.baseUrl;
      }
    }
    this.showUpstreamDropdown = false;
    this.upstreamFilter = '';
    this.providerModelNames = [];
    this.showModelModal = true;
  }

  async fetchProviderKey(modelId: string): Promise<void> {
    try {
      const response = await this.api.getModelProviderKey(modelId);
      if (response.key) {
        const storageId = this.getModelProviderKeyId(modelId);
        this.providerKeyStorage.set(storageId, response.key);
        if (this.editingModelId === modelId) {
          this.modelDraft.providerApiKey = response.key;
        }
      }
    } catch (err) {
      // Silently fail - user can still enter a new key
      console.error('Failed to fetch provider key:', err);
    }
  }

  getProviderKeyDisplay(): string {
    const storageId = this.currentProviderKeyId;
    if (!storageId) return '';
    const key = this.modelDraft.providerApiKey || this.providerKeyStorage.get(storageId);
    if (!key) return '';
    if (this.visibleProviderKeys.has(storageId)) return key;
    return '•'.repeat(Math.min(key.length, 32));
  }

  isProviderKeyVisible(): boolean {
    return this.currentProviderKeyId
      ? this.visibleProviderKeys.has(this.currentProviderKeyId)
      : false;
  }

  toggleProviderKeyVisibility(): void {
    const storageId = this.currentProviderKeyId;
    if (!storageId) return;
    if (this.visibleProviderKeys.has(storageId)) {
      this.visibleProviderKeys.delete(storageId);
    } else {
      this.visibleProviderKeys.add(storageId);
    }
  }

  async copyProviderKey(): Promise<void> {
    const storageId = this.currentProviderKeyId;
    if (!storageId) return;
    const key = this.modelDraft.providerApiKey || this.providerKeyStorage.get(storageId);
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      this.showNotice('Provider key copied');
    } catch {
      this.showError('Failed to copy');
    }
  }

  toggleProviderKeyVisibilityForProvider(): void {
    if (!this.editingProviderId) return;
    if (this.visibleProviderKeys.has(this.editingProviderId)) {
      this.visibleProviderKeys.delete(this.editingProviderId);
    } else {
      this.visibleProviderKeys.add(this.editingProviderId);
    }
  }

  async copyProviderKeyForProvider(): Promise<void> {
    if (!this.editingProviderId) return;
    const key = this.providerDraft.apiKey || this.providerKeyStorage.get(this.editingProviderId);
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      this.showNotice('Provider key copied');
    } catch {
      this.showError('Failed to copy');
    }
  }

  get currentProviderKeyId(): string {
    if (this.modelDraft.providerId) {
      return this.modelDraft.providerId;
    }
    if (this.editingModelId) {
      return this.getModelProviderKeyId(this.editingModelId);
    }
    return '';
  }

  get selectedProvider(): Provider | null {
    return this.providers.find((provider) => provider.id === this.modelDraft.providerId) || null;
  }

  get selectedPlaygroundModel(): ProxyModel | null {
    return this.proxyModels.find((model) => model.id === this.playgroundModelId) || null;
  }

  get availableFallbackModels(): ProxyModel[] {
    if (!this.editingModelId) {
      return this.proxyModels;
    }
    return this.proxyModels.filter((model) => model.id !== this.editingModelId);
  }

  get isCustomProviderSelection(): boolean {
    return !this.modelDraft.providerId;
  }

  onModelProviderChange(): void {
    this.providerModelNames = [];
    this.showUpstreamDropdown = false;
    this.upstreamFilter = '';

    if (this.modelDraft.providerId) {
      const provider = this.selectedProvider;
      if (provider) {
        this.modelDraft.providerBaseUrl = provider.baseUrl;
      }
      this.modelDraft.providerApiKey = '';
      return;
    }

    this.modelDraft.providerBaseUrl =
      this.modelDraft.providerBaseUrl || 'https://api.openai.com/v1';
  }

  onModelProtocolChange(): void {
    if (this.modelDraft.providerProtocol === 'chat_completions') {
      this.modelDraft.reasoningSummaryMode = 'off';
      this.modelDraft.reasoningOutputMode = 'off';
    }
  }

  get selectedOcrProvider(): Provider | null {
    return this.providers.find((provider) => provider.id === this.ocrDraft.providerId) || null;
  }

  get isCustomOcrProvider(): boolean {
    return !this.ocrDraft.providerId;
  }

  onOcrProviderChange(): void {
    if (this.ocrDraft.providerId) {
      const provider = this.selectedOcrProvider;
      if (provider) {
        this.ocrDraft.providerBaseUrl = provider.baseUrl;
      }
      this.ocrApiKey = '';
      return;
    }
    this.ocrDraft.providerBaseUrl = this.ocrDraft.providerBaseUrl || 'https://api.openai.com/v1';
  }

  private getModelProviderKeyId(modelId: string): string {
    return `custom:${modelId}`;
  }

  async loadProviderModels(): Promise<void> {
    try {
      const response = this.modelDraft.providerId
        ? await this.api.fetchStoredProviderModels(this.modelDraft.providerId)
        : await this.api.fetchProviderModels({
            providerBaseUrl: this.modelDraft.providerBaseUrl,
            apiKey: this.modelDraft.providerApiKey,
          });
      this.providerModelNames = response.items;
      this.showNotice(`Found ${response.items.length} models`);
      if (this.providerModelNames.length > 0) {
        this.showUpstreamDropdown = true;
      }
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  get filteredUpstreamModels(): string[] {
    if (!this.upstreamFilter.trim()) {
      return this.providerModelNames;
    }
    const filter = this.upstreamFilter.toLowerCase();
    return this.providerModelNames.filter((name) => name.toLowerCase().includes(filter));
  }

  selectUpstreamModel(name: string): void {
    this.modelDraft.upstreamModelName = name;
    this.showUpstreamDropdown = false;
    this.upstreamFilter = '';
  }

  onStickyFallbackSettingsChange(): void {
    if (this.modelDraft.stickyFallbackSeconds <= 0) {
      this.modelDraft.slowStickyEnabled = false;
    }
  }

  async saveModel(): Promise<void> {
    try {
      const fallbackEnabled = this.modelDraft.fallbackEnabled;
      const stickyEnabled = fallbackEnabled && this.modelDraft.stickyFallbackSeconds > 0;
      const payload = {
        ...this.modelDraft,
        // If retry is not enabled, set maxRetries to 0 and clear fallbackModelId
        maxRetries: fallbackEnabled ? this.modelDraft.maxRetries : 0,
        fallbackModelId: fallbackEnabled ? this.modelDraft.fallbackModelId || null : null,
        firstTokenTimeoutEnabled: fallbackEnabled
          ? this.modelDraft.firstTokenTimeoutEnabled
          : false,
        slowStickyEnabled: stickyEnabled ? this.modelDraft.slowStickyEnabled : false,
      };
      if (this.editingModelId) {
        await this.api.updateModel(this.editingModelId, payload);
        if (this.modelDraft.providerApiKey && !this.modelDraft.providerId) {
          this.providerKeyStorage.set(
            this.getModelProviderKeyId(this.editingModelId),
            this.modelDraft.providerApiKey,
          );
        }
        this.showNotice('Model updated');
      } else {
        const response = await this.api.createModel(payload);
        if (this.modelDraft.providerApiKey && response.item.id && !this.modelDraft.providerId) {
          this.providerKeyStorage.set(
            this.getModelProviderKeyId(response.item.id),
            this.modelDraft.providerApiKey,
          );
        }
        this.showNotice('Model created');
      }
      this.showModelModal = false;
      this.resetModelDraft();
      await this.refreshAll();
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async deleteModel(model: ProxyModel): Promise<void> {
    if (!confirm(`Delete model "${model.displayName}"?`)) return;
    try {
      await this.api.deleteModel(model.id);
      const storageId = this.getModelProviderKeyId(model.id);
      this.providerKeyStorage.delete(storageId);
      this.visibleProviderKeys.delete(storageId);
      await this.refreshAll();
      this.showNotice(`Model deleted: ${model.displayName}`);
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  resetModelDraft(): void {
    this.editingModelId = '';
    this.modelDraft = createEmptyModelDraft();
    if (this.providers[0]) {
      this.modelDraft.providerId = this.providers[0].id;
      this.modelDraft.providerBaseUrl = this.providers[0].baseUrl;
    }
    this.providerModelNames = [];
    this.showUpstreamDropdown = false;
    this.upstreamFilter = '';
  }

  hasCustomParams(model: ProxyModel): boolean {
    return model.customParams && Object.keys(model.customParams).length > 0;
  }

  // Settings
  get settingsDirty(): boolean {
    return this.loggingDraftDirty || this.refreshDraftDirty;
  }

  async saveSettings(): Promise<void> {
    try {
      if (this.loggingDraftDirty) {
        await this.api.saveLoggingSettings(this.loggingDraft);
        this.loggingDraftDirty = false;
      }
      if (this.refreshDraftDirty) {
        await this.api.saveRefreshSettings(this.refreshDraft);
        this.refreshDraftDirty = false;
        this.restartAutoRefresh();
      }
      this.showNotice('Settings saved');
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async saveLogging(): Promise<void> {
    try {
      await this.api.saveLoggingSettings(this.loggingDraft);
      this.loggingDraftDirty = false;
      this.showNotice('Logging settings saved');
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async saveOcr(): Promise<void> {
    try {
      await this.api.saveOcrSettings({
        ...this.ocrDraft,
        apiKey: this.isCustomOcrProvider ? this.ocrApiKey : undefined,
      });
      this.ocrApiKey = '';
      this.ocrDraftDirty = false;
      this.showNotice('OCR settings saved');
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async saveRefresh(): Promise<void> {
    try {
      await this.api.saveRefreshSettings(this.refreshDraft);
      this.refreshDraftDirty = false;
      this.showNotice('Auto-refresh settings saved');
      this.restartAutoRefresh();
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  openMigrationModal(): void {
    this.migrationSelectedFileName = '';
    this.showMigrationModal = true;
  }

  async exportMigration(): Promise<void> {
    this.migrationBusy = true;
    try {
      const { blob, filename } = await this.api.exportMigration(this.migrationIncludeUsageHistory);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      this.showNotice(
        this.migrationIncludeUsageHistory
          ? 'App config exported with usage logs'
          : 'App config exported',
      );
    } catch (err) {
      this.showError(this.normalizeError(err));
    } finally {
      this.migrationBusy = false;
    }
  }

  async handleMigrationFileInput(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] || null;
    target.value = '';

    if (!file) {
      return;
    }

    this.migrationSelectedFileName = file.name;

    const confirmMessage = this.migrationIncludeUsageHistory
      ? 'Importing this app config will overwrite keys, providers, models, simulations, settings, and existing usage logs. Continue?'
      : 'Importing this app config will overwrite keys, providers, models, simulations, and settings. Existing usage logs will be kept. Continue?';
    if (!confirm(confirmMessage)) {
      return;
    }

    this.migrationBusy = true;
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      const result = await this.api.importMigration({
        includeUsageHistory: this.migrationIncludeUsageHistory,
        backup,
      });
      this.keyStorage.clear();
      this.visibleKeys.clear();
      this.providerKeyStorage.clear();
      this.visibleProviderKeys.clear();
      this.loggingDraftDirty = false;
      this.ocrDraftDirty = false;
      this.refreshDraftDirty = false;
      this.showMigrationModal = false;
      this.migrationSelectedFileName = '';
      await this.refreshAll();
      this.showNotice(this.formatMigrationImportNotice(result));
    } catch (err) {
      if (err instanceof SyntaxError) {
        this.showError('Selected file is not valid JSON');
      } else {
        this.showError(this.normalizeError(err));
      }
    } finally {
      this.migrationBusy = false;
    }
  }

  private formatMigrationImportNotice(result: {
    counts: { usageLogs: number };
    usageHistoryReplaced: boolean;
  }): string {
    if (!result.usageHistoryReplaced) {
      return 'App config imported';
    }
    return `App config imported with ${result.counts.usageLogs} usage log${
      result.counts.usageLogs === 1 ? '' : 's'
    }`;
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (this.refreshDraft.enabled && this.refreshDraft.intervalSeconds > 0) {
      this.refreshTimer = setInterval(() => {
        void this.refreshAll();
      }, this.refreshDraft.intervalSeconds * 1000);
    }
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private restartAutoRefresh(): void {
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.clearNotice();
    this.clearError();
  }

  // Playground
  async handleFileInput(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files || []);
    const next: Attachment[] = [];
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        next.push({
          kind: 'image',
          name: file.name,
          payload: await this.readAsDataUrl(file),
        });
      } else {
        next.push({
          kind: 'text',
          name: file.name,
          payload: await file.text(),
        });
      }
    }
    this.attachments = next;
  }

  removeAttachment(attachment: Attachment): void {
    this.attachments = this.attachments.filter((a) => a !== attachment);
  }

  async sendPlaygroundPrompt(): Promise<void> {
    if (!this.playgroundModelId) {
      this.showError('Select a model');
      return;
    }
    this.playgroundBusy = true;
    this.showError('');

    const userTextParts = [
      this.playgroundPrompt.trim(),
      ...this.attachments
        .filter((a) => a.kind === 'text')
        .map((a) => `[File: ${a.name}]\n${a.payload}`),
    ].filter(Boolean);

    const userContent: Array<Record<string, unknown>> = [];
    if (userTextParts.length > 0) {
      userContent.push({ type: 'text', text: userTextParts.join('\n\n') });
    }
    for (const attachment of this.attachments.filter((a) => a.kind === 'image')) {
      userContent.push({
        type: 'image_url',
        image_url: { url: attachment.payload },
      });
    }

    const messages: Array<Record<string, unknown>> = [];
    if (this.playgroundSystemPrompt.trim()) {
      messages.push({
        role: 'system',
        content: this.playgroundSystemPrompt.trim(),
      });
    }
    messages.push({
      role: 'user',
      content:
        userContent.length === 1 && userContent[0]['type'] === 'text'
          ? userTextParts.join('\n\n')
          : userContent,
    });

    this.transcript.push({
      role: 'user',
      text: userTextParts.join('\n\n') || `${this.attachments.length} attachment(s)`,
    });

    try {
      if (this.playgroundStream) {
        await this.sendStreaming(messages);
      } else {
        const response = await fetch('/api/admin/playground/chat', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.playgroundModelId,
            messages,
            stream: false,
          }),
        });
        const json = await response.json();
        const message = json?.choices?.[0]?.message;
        const text = this.extractMessageText(message);
        const reasoningText =
          typeof message?.reasoning_content === 'string' ? message.reasoning_content : undefined;
        this.transcript.push({ role: 'assistant', text, reasoningText });
      }
      this.playgroundPrompt = '';
      this.attachments = [];
    } catch (err) {
      this.showError(this.normalizeError(err));
    } finally {
      this.playgroundBusy = false;
    }
  }

  private async sendStreaming(messages: Array<Record<string, unknown>>): Promise<void> {
    const response = await fetch('/api/admin/playground/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.playgroundModelId,
        messages,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(await response.text());
    }
    const assistantMsg: TranscriptMessage = { role: 'assistant', text: '' };
    this.transcript.push(assistantMsg);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        const dataLines = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .filter(Boolean);
        for (const line of dataLines) {
          if (line === '[DONE]') continue;
          try {
            const json = JSON.parse(line);
            const delta = json?.choices?.[0]?.delta?.content;
            const reasoningDelta = json?.choices?.[0]?.delta?.reasoning_content;
            if (typeof delta === 'string') {
              assistantMsg.text += delta;
            }
            if (typeof reasoningDelta === 'string') {
              assistantMsg.reasoningText = (assistantMsg.reasoningText || '') + reasoningDelta;
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    }
  }

  // SimModels
  openSimModelModal(): void {
    this.editingSimModelId = '';
    this.simModelDraft = createEmptySimModelDraft();
    this.showSimModelModal = true;
  }

  editSimModel(model: SimModel): void {
    this.editingSimModelId = model.id;
    this.simModelDraft = {
      displayName: model.displayName,
      description: model.description || '',
      isActive: model.isActive,
      exposeInModels: model.exposeInModels,
      segments: model.segments.map((s) =>
        s.type === 'text' ? { ...s, maxUpdatesPerSecond: s.maxUpdatesPerSecond ?? 10 } : { ...s },
      ),
    };
    this.showSimModelModal = true;
  }

  addDelaySegment(): void {
    this.simModelDraft.segments.push({
      type: 'delay',
      delayMs: 1000,
    });
  }

  addTextSegment(): void {
    this.simModelDraft.segments.push({
      type: 'text',
      content: '',
      ratePerSecond: 30,
      unit: 'token',
      maxUpdatesPerSecond: 10,
    });
  }

  removeSegment(index: number): void {
    this.simModelDraft.segments.splice(index, 1);
  }

  moveSegment(index: number, direction: 'up' | 'down'): void {
    if (direction === 'up' && index > 0) {
      const temp = this.simModelDraft.segments[index];
      this.simModelDraft.segments[index] = this.simModelDraft.segments[index - 1];
      this.simModelDraft.segments[index - 1] = temp;
    } else if (direction === 'down' && index < this.simModelDraft.segments.length - 1) {
      const temp = this.simModelDraft.segments[index];
      this.simModelDraft.segments[index] = this.simModelDraft.segments[index + 1];
      this.simModelDraft.segments[index + 1] = temp;
    }
  }

  async saveSimModel(): Promise<void> {
    try {
      const payload = { ...this.simModelDraft };
      if (this.editingSimModelId) {
        await this.api.updateSimModel(this.editingSimModelId, payload);
        this.showNotice('Simulation model updated');
      } else {
        await this.api.createSimModel(payload);
        this.showNotice('Simulation model created');
      }
      this.showSimModelModal = false;
      await this.refreshAll();
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  async deleteSimModel(model: SimModel): Promise<void> {
    if (!confirm(`Delete simulation model "${model.displayName}"?`)) return;
    try {
      await this.api.deleteSimModel(model.id);
      await this.refreshAll();
      this.showNotice(`Simulation model deleted: ${model.displayName}`);
    } catch (err) {
      this.showError(this.normalizeError(err));
    }
  }

  resetSimModelDraft(): void {
    this.editingSimModelId = '';
    this.simModelDraft = createEmptySimModelDraft();
  }

  // Utilities
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value || 0);
  }

  private readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  private extractMessageText(message: unknown): string {
    if (!message || typeof message !== 'object') {
      return JSON.stringify(message, null, 2);
    }

    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== 'object') return '';
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return JSON.stringify(message, null, 2);
  }

  private normalizeError(error: unknown): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      const nestedError = (error as { error?: unknown }).error;
      if (typeof nestedError === 'string') return nestedError;
    }
    return 'Request failed';
  }
}
