import { Routes } from '@angular/router';
import { AdminPageComponent } from './pages/admin-page.component';
import { LaunchPageComponent } from './pages/launch-page.component';
import { LoginPageComponent } from './pages/login-page.component';
import { SetupPageComponent } from './pages/setup-page.component';

export const routes: Routes = [
  { path: '', component: LaunchPageComponent },
  { path: 'setup', component: SetupPageComponent },
  { path: 'login', component: LoginPageComponent },
  { path: 'admin', redirectTo: '/admin/overview', pathMatch: 'full' },
  { path: 'admin/:tab', component: AdminPageComponent },
  { path: '**', redirectTo: '' },
];
