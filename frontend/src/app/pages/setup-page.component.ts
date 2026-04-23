import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { ApiService } from "../services/api.service";

@Component({
  selector: "app-setup-page",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-page">
      <div class="login-box">
        <div class="login-header">
          <h1>Initial Setup</h1>
          <p class="text-muted">Create the admin account</p>
        </div>
        
        <form (ngSubmit)="submit()" class="form-section" style="gap: var(--space-lg);">
          <label>
            <span>Username</span>
            <input 
              [(ngModel)]="username" 
              name="username" 
              required 
              autofocus
              placeholder="admin"
            >
          </label>
          
          <label>
            <span>Password</span>
            <input 
              [(ngModel)]="password" 
              name="password" 
              type="password" 
              required
              minlength="8"
              placeholder="8+ characters"
            >
          </label>
          
          <label>
            <span>Confirm Password</span>
            <input 
              [(ngModel)]="confirmPassword" 
              name="confirmPassword" 
              type="password" 
              required
              placeholder="Re-enter password"
            >
          </label>
          
          <div *ngIf="error" class="text-danger" style="font-size: 13px;">
            {{ error }}
          </div>
          
          <button 
            type="submit" 
            class="primary" 
            [disabled]="submitting"
            style="margin-top: var(--space-sm);"
          >
            {{ submitting ? 'Creating...' : 'Create Admin' }}
          </button>
        </form>
      </div>
    </div>
  `,
})
export class SetupPageComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  username = "";
  password = "";
  confirmPassword = "";
  error = "";
  submitting = false;

  async submit(): Promise<void> {
    this.error = "";

    if (this.password !== this.confirmPassword) {
      this.error = "Passwords do not match";
      return;
    }

    if (this.password.length < 8) {
      this.error = "Password must be at least 8 characters";
      return;
    }

    this.submitting = true;
    try {
      await this.api.createInitialAdmin({
        username: this.username,
        password: this.password,
      });
      await this.router.navigateByUrl("/admin/overview");
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Setup failed";
    } finally {
      this.submitting = false;
    }
  }
}
