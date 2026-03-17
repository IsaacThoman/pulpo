import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-page">
      <div class="login-box">
        <div class="login-header">
          <h1>pulpo</h1>
          <p class="text-muted">Admin sign in</p>
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
              placeholder="••••••••"
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
            {{ submitting ? 'Signing in...' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  `,
})
export class LoginPageComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  username = '';
  password = '';
  error = '';
  submitting = false;

  async submit(): Promise<void> {
    this.error = '';
    this.submitting = true;
    try {
      await this.api.login({
        username: this.username,
        password: this.password,
      });
      await this.router.navigateByUrl('/admin');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Sign in failed';
    } finally {
      this.submitting = false;
    }
  }
}
