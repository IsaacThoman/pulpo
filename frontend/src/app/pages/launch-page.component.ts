import { Component, inject } from "@angular/core";
import { Router } from "@angular/router";
import { ApiService } from "../services/api.service";

@Component({
  selector: "app-launch-page",
  standalone: true,
  template: `
    <div class="login-page">
      <div class="login-box" style="text-align: center;">
        <h1 style="margin-bottom: var(--space-md);">pulpo</h1>
        <div class="flex items-center justify-center gap-sm" style="color: var(--text-muted);">
          <span class="dot" [class.success]="!checking" [class.warning]="checking"></span>
          <span>{{ message }}</span>
        </div>
      </div>
    </div>
  `,
})
export class LaunchPageComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  checking = true;
  message = "Initializing...";

  constructor() {
    void this.route();
  }

  private async route(): Promise<void> {
    try {
      this.message = "Checking setup...";
      const setup = await this.api.getSetupStatus();
      if (setup.needsSetup) {
        await this.router.navigateByUrl("/setup");
        return;
      }

      this.message = "Verifying session...";
      const me = await this.api.getMe();
      await this.router.navigateByUrl(me.admin ? "/admin" : "/login");
    } catch {
      await this.router.navigateByUrl("/login");
    } finally {
      this.checking = false;
    }
  }
}
