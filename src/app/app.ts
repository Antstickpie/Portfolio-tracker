import { Component, signal, inject } from '@angular/core';
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

  public switchTab(tab: 'dashboard' | 'import' | 'ledger' | 'prices') {
    this.activeTab.set(tab);
  }
}
