import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  AdminUser,
  LoggingSettings,
  OcrSettings,
  Provider,
  ProxyKey,
  ProxyModel,
  RefreshSettings,
  SimModel,
  UsageSummary,
} from '../models/api-types';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);

  getSetupStatus(): Promise<{ needsSetup: boolean }> {
    return firstValueFrom(this.http.get<{ needsSetup: boolean }>('/api/setup/status'));
  }

  createInitialAdmin(payload: { username: string; password: string }): Promise<{ admin: AdminUser }> {
    return firstValueFrom(this.http.post<{ admin: AdminUser }>('/api/setup', payload));
  }

  login(payload: { username: string; password: string }): Promise<{ admin: AdminUser }> {
    return firstValueFrom(this.http.post<{ admin: AdminUser }>('/api/admin/login', payload));
  }

  logout(): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.post<{ ok: boolean }>('/api/admin/logout', {}));
  }

  getMe(): Promise<{ admin: AdminUser | null }> {
    return firstValueFrom(this.http.get<{ admin: AdminUser | null }>('/api/admin/me'));
  }

  listProxyKeys(): Promise<{ items: ProxyKey[] }> {
    return firstValueFrom(this.http.get<{ items: ProxyKey[] }>('/api/admin/proxy-keys'));
  }

  createProxyKey(payload: { name: string; isActive: boolean }): Promise<{ item: ProxyKey; plainTextKey: string }> {
    return firstValueFrom(
      this.http.post<{ item: ProxyKey; plainTextKey: string }>('/api/admin/proxy-keys', payload),
    );
  }

  updateProxyKey(id: string, payload: Partial<{ name: string; isActive: boolean }>): Promise<{ item: ProxyKey }> {
    return firstValueFrom(this.http.patch<{ item: ProxyKey }>(`/api/admin/proxy-keys/${id}`, payload));
  }

  rotateProxyKey(id: string): Promise<{ item: ProxyKey; plainTextKey: string }> {
    return firstValueFrom(
      this.http.post<{ item: ProxyKey; plainTextKey: string }>(`/api/admin/proxy-keys/${id}/rotate`, {}),
    );
  }

  deleteProxyKey(id: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`/api/admin/proxy-keys/${id}`));
  }

  listProviders(): Promise<{ items: Provider[] }> {
    return firstValueFrom(this.http.get<{ items: Provider[] }>('/api/admin/providers'));
  }

  createProvider(payload: Record<string, unknown>): Promise<{ item: Provider }> {
    return firstValueFrom(this.http.post<{ item: Provider }>('/api/admin/providers', payload));
  }

  updateProvider(id: string, payload: Record<string, unknown>): Promise<{ item: Provider }> {
    return firstValueFrom(this.http.patch<{ item: Provider }>(`/api/admin/providers/${id}`, payload));
  }

  deleteProvider(id: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`/api/admin/providers/${id}`));
  }

  getProviderApiKey(id: string): Promise<{ key: string | null }> {
    return firstValueFrom(this.http.get<{ key: string | null }>(`/api/admin/providers/${id}/api-key`));
  }

  fetchStoredProviderModels(id: string): Promise<{ items: string[] }> {
    return firstValueFrom(this.http.post<{ items: string[] }>(`/api/admin/providers/${id}/models`, {}));
  }

  listModels(): Promise<{ items: ProxyModel[] }> {
    return firstValueFrom(this.http.get<{ items: ProxyModel[] }>('/api/admin/models'));
  }

  createModel(payload: Record<string, unknown>): Promise<{ item: ProxyModel }> {
    return firstValueFrom(this.http.post<{ item: ProxyModel }>('/api/admin/models', payload));
  }

  updateModel(id: string, payload: Record<string, unknown>): Promise<{ item: ProxyModel }> {
    return firstValueFrom(this.http.patch<{ item: ProxyModel }>(`/api/admin/models/${id}`, payload));
  }

  deleteModel(id: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`/api/admin/models/${id}`));
  }

  getModelProviderKey(id: string): Promise<{ key: string | null }> {
    return firstValueFrom(this.http.get<{ key: string | null }>(`/api/admin/models/${id}/provider-key`));
  }

  fetchProviderModels(payload: {
    providerBaseUrl: string;
    apiKey: string;
  }): Promise<{ items: string[] }> {
    return firstValueFrom(
      this.http.post<{ items: string[] }>('/api/admin/models/provider-models', payload),
    );
  }

  getLoggingSettings(): Promise<LoggingSettings> {
    return firstValueFrom(this.http.get<LoggingSettings>('/api/admin/settings/logging'));
  }

  saveLoggingSettings(payload: LoggingSettings): Promise<LoggingSettings> {
    return firstValueFrom(this.http.put<LoggingSettings>('/api/admin/settings/logging', payload));
  }

  getOcrSettings(): Promise<OcrSettings> {
    return firstValueFrom(this.http.get<OcrSettings>('/api/admin/settings/ocr'));
  }

  saveOcrSettings(payload: Record<string, unknown>): Promise<OcrSettings> {
    return firstValueFrom(this.http.put<OcrSettings>('/api/admin/settings/ocr', payload));
  }

  getRefreshSettings(): Promise<RefreshSettings> {
    return firstValueFrom(this.http.get<RefreshSettings>('/api/admin/settings/refresh'));
  }

  saveRefreshSettings(payload: RefreshSettings): Promise<RefreshSettings> {
    return firstValueFrom(this.http.put<RefreshSettings>('/api/admin/settings/refresh', payload));
  }

  getUsageSummary(days = 30): Promise<UsageSummary> {
    return firstValueFrom(this.http.get<UsageSummary>(`/api/admin/usage/summary?days=${days}`));
  }

  // SimModels
  listSimModels(): Promise<{ items: SimModel[] }> {
    return firstValueFrom(this.http.get<{ items: SimModel[] }>('/api/admin/sim-models'));
  }

  createSimModel(payload: Record<string, unknown>): Promise<{ item: SimModel }> {
    return firstValueFrom(this.http.post<{ item: SimModel }>('/api/admin/sim-models', payload));
  }

  updateSimModel(id: string, payload: Record<string, unknown>): Promise<{ item: SimModel }> {
    return firstValueFrom(this.http.patch<{ item: SimModel }>(`/api/admin/sim-models/${id}`, payload));
  }

  deleteSimModel(id: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`/api/admin/sim-models/${id}`));
  }
}
