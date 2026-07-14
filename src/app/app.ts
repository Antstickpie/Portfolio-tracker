import { Component, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './components/dashboard';
import { ImportComponent } from './components/import';
import { TransactionsComponent } from './components/transactions';
import { PricesComponent } from './components/prices';
import { PortfolioService } from './services/portfolio.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    DashboardComponent, 
    ImportComponent, 
    TransactionsComponent, 
    PricesComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  public service = inject(PortfolioService);
  public activeTab = signal<'dashboard' | 'import' | 'ledger' | 'prices'>('dashboard');

  // True when only demo data is loaded (no real user data yet)
  public isDemoMode = computed(() => {
    const txs = this.service.transactions();
    return txs.length > 0 && txs.every(t => (t as any)._isDemo === true);
  });

  public switchTab(tab: 'dashboard' | 'import' | 'ledger' | 'prices') {
    this.activeTab.set(tab);
  }
}
