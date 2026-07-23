import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioService } from '../services/portfolio.service';
import { Transaction } from '../models/transaction.model';

import { ImportComponent } from './import';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, ImportComponent],
  templateUrl: './transactions.html',
  styleUrl: './transactions.css'
})
export class TransactionsComponent {
  public service = inject(PortfolioService);

  public showAddForm = signal(false);
  public showImport = signal(false);
  public showCashTopUp = signal(false);
  public collapsedAccounts = signal<Record<string, boolean>>({});

  public toggleAccountCollapse(accountName: string) {
    this.collapsedAccounts.update(prev => ({
      ...prev,
      [accountName]: !prev[accountName]
    }));
  }

  public isAccountCollapsed(accountName: string): boolean {
    const groups = this.transactionsByAccount();
    // If only one account: always expanded
    if (groups.length <= 1) return false;
    // Multiple accounts: collapsed by default unless explicitly toggled open
    const explicitState = this.collapsedAccounts()[accountName];
    return explicitState === undefined ? true : explicitState;
  }
  public sortBy = signal<'date' | 'price' | 'ticker' | 'type' | 'quantity' | 'totalAmount' | 'name'>('date');
  public sortDirection = signal<'asc' | 'desc'>('desc');
  
  // Track expanded transaction row
  public expandedTxId = signal<string | null>(null);

  public displayCurrency = computed(() => {
    const globalCurr = this.service.displayCurrency();
    return globalCurr === 'native' ? this.service.defaultCurrency() : globalCurr;
  });

  public getAccountCurrentValue(accountName: string): string {
    const txs = this.service.transactions().filter(t => (t.source || 'Manual Entries') === accountName);
    
    // Group by ticker to find net quantity
    const tickerQty: Record<string, number> = {};
    txs.forEach((tx) => {
      if (!tx.ticker) return;
      const clean = tx.ticker.toUpperCase().trim();
      
      if (tx.type === 'BUY') {
        tickerQty[clean] = (tickerQty[clean] || 0) + tx.quantity;
      } else if (tx.type === 'SELL') {
        tickerQty[clean] = (tickerQty[clean] || 0) - tx.quantity;
      }
    });

    let totalUsd = 0;
    Object.entries(tickerQty).forEach(([ticker, qty]) => {
      if (qty <= 0) return;
      const meta = this.service.tickerConfigs()[ticker];
      
      let priceNative = meta ? (meta.currentPrice || 0) : 0;
      if (priceNative <= 0) {
        // Fallback: use the price of the last BUY transaction globally for this ticker
        const globalTxs = this.service.transactions().filter(t => t.ticker.toUpperCase() === ticker && t.type === 'BUY');
        if (globalTxs.length > 0) {
          priceNative = globalTxs[globalTxs.length - 1].price || 0;
        }
      }
      
      const tickerCurrency = this.service.getTickerCurrency(ticker);
      const rateToUsd = this.service.getExchangeRate(tickerCurrency, 'USD');
      const priceUsd = priceNative * rateToUsd;
      
      totalUsd += qty * priceUsd;
    });

    // Format to selected currency
    const targetCurr = this.displayCurrency();
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const converted = totalUsd * rate;
    const symbol = this.service.getCurrencySymbol(targetCurr);
    return symbol + converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Filters State
  public filterTicker = '';
  public filterType = '';
  public filterSource = '';

  public newTxSource = 'Manual Entries';

  // Manual Transaction Form Model
  public newTx = {
    date: this.getLocalDateString(),
    ticker: '',
    type: 'BUY',
    quantity: 0,
    price: 0,
    totalAmount: 0,
    currency: 'USD',
    fxRate: 1.0,
    fees: 0,
  };

  public filteredTransactions = computed(() => {
    let txs = this.service.transactions();
    
    // Sort based on sortBy and sortDirection
    const dir = this.sortDirection();
    const field = this.sortBy();
    
    txs = [...txs].sort((a, b) => {
      let valA: any;
      let valB: any;
      
      if (field === 'date') {
        valA = new Date(a.date).getTime();
        valB = new Date(b.date).getTime();
      } else if (field === 'ticker') {
        valA = (a.ticker || '').toUpperCase();
        valB = (b.ticker || '').toUpperCase();
      } else if (field === 'type') {
        valA = a.type.toUpperCase();
        valB = b.type.toUpperCase();
      } else if (field === 'quantity') {
        valA = a.quantity || 0;
        valB = b.quantity || 0;
      } else if (field === 'price') {
        valA = a.price || 0;
        valB = b.price || 0;
      } else if (field === 'totalAmount') {
        valA = a.totalAmount || 0;
        valB = b.totalAmount || 0;
      } else if (field === 'name') {
        const nameA = this.service.tickerConfigs()[a.ticker]?.name || a.ticker || '';
        const nameB = this.service.tickerConfigs()[b.ticker]?.name || b.ticker || '';
        valA = nameA.toUpperCase();
        valB = nameB.toUpperCase();
      }
      
      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      
      // Secondary chronological fallback sort
      if (field !== 'date') {
        const timeA = new Date(a.date).getTime();
        const timeB = new Date(b.date).getTime();
        return timeA - timeB;
      }
      return 0;
    });

    // Filter out CASH TOP-UP transactions if hide checkbox is active
    if (!this.showCashTopUp()) {
      txs = txs.filter((t: Transaction) => t.type !== 'CASH TOP-UP');
    }

    if (this.filterTicker.trim()) {
      const q = this.filterTicker.toUpperCase().trim();
      txs = txs.filter((t: Transaction) => (t.ticker || '').toUpperCase().includes(q));
    }
    if (this.filterType) {
      txs = txs.filter((t: Transaction) => t.type === this.filterType);
    }
    if (this.filterSource.trim()) {
      const src = this.filterSource.toLowerCase().trim();
      txs = txs.filter((t: Transaction) => t.source.toLowerCase().includes(src));
    }

    return txs;
  });

  public transactionsByAccount = computed(() => {
    const txs = this.filteredTransactions();
    const groups: Record<string, Transaction[]> = {};
    
    txs.forEach((tx) => {
      const acc = tx.source || 'Manual Entries';
      if (!groups[acc]) {
        groups[acc] = [];
      }
      groups[acc].push(tx);
    });
    
    return Object.entries(groups)
      .map(([name, list]) => ({ name, list }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  public getTypeBadgeClass(type: string): string {
    switch (type) {
      case 'BUY': return 'badge-success';
      case 'SELL': return 'badge-danger';
      case 'DIVIDEND': return 'badge-info';
      default: return 'badge-info';
    }
  }

  public isSplit(tx: Transaction): boolean {
    if (tx.type === 'DIVIDEND') {
      return tx.personBCostBasis > 0 && tx.personACostBasis > 0;
    }
    return tx.personBShares > 0 && tx.personAShares > 0;
  }

  public setSort(field: 'date' | 'price' | 'ticker' | 'type' | 'quantity' | 'totalAmount' | 'name') {
    if (this.sortBy() === field) {
      this.sortDirection.update((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      this.sortBy.set(field);
      this.sortDirection.set(field === 'ticker' || field === 'type' ? 'asc' : 'desc');
    }
  }

  public toggleOwner(tx: Transaction, event: Event) {
    event.stopPropagation();
    if (tx.personBShares === 0) {
      // Toggle to 100% Person B
      this.service.updateTransactionAllocation(tx.id, tx.quantity, tx.totalAmount);
    } else {
      // Toggle to 100% Person A
      this.service.updateTransactionAllocation(tx.id, 0, 0);
    }
  }

  public toggleExpand(txId: string) {
    if (this.expandedTxId() === txId) {
      this.expandedTxId.set(null);
    } else {
      this.expandedTxId.set(txId);
    }
  }

  // Pill visualizer helpers
  public getPillWidth(tx: Transaction, owner: 'A' | 'B'): number {
    if (tx.type === 'DIVIDEND' || tx.quantity === 0) {
      const totalCost = tx.totalAmount;
      if (totalCost === 0) return owner === 'A' ? 100 : 0;
      const val = owner === 'A' ? tx.personACostBasis : tx.personBCostBasis;
      return (val / totalCost) * 100;
    }
    
    const total = tx.quantity;
    if (total === 0) return owner === 'A' ? 100 : 0;
    const val = owner === 'A' ? tx.personAShares : tx.personBShares;
    return (val / total) * 100;
  }

  public getPillLabel(tx: Transaction, owner: 'A' | 'B'): string {
    const pct = this.getPillWidth(tx, owner);
    if (pct < 15) return ''; // don't write label if too narrow
    
    const name = owner === 'A' ? this.service.personAName() : this.service.personBName();
    return `${name} (${Math.round(pct)}%)`;
  }

  // Allocation modes: allA, allB, split
  public getAllocationMode(tx: Transaction): 'allA' | 'allB' | 'split' {
    if (tx.personBShares === 0) return 'allA';
    if (tx.personAShares === 0) return 'allB';
    return 'split';
  }

  public setAllocationMode(tx: Transaction, mode: 'allA' | 'allB' | 'split') {
    if (mode === 'allA') {
      this.service.updateTransactionAllocation(tx.id, 0, 0);
    } else if (mode === 'allB') {
      this.service.updateTransactionAllocation(tx.id, tx.quantity, tx.totalAmount);
    } else {
      // Initialize custom split to 50/50
      const bShares = parseFloat((tx.quantity * 0.5).toFixed(6));
      const bCost = parseFloat((tx.totalAmount * 0.5).toFixed(2));
      this.service.updateTransactionAllocation(tx.id, bShares, bCost);
    }
  }

  // Handle custom share splits (Taylor's shares) - auto calculates cost Basis
  public onSharesSplitChange(tx: Transaction, event: Event) {
    const valStr = (event.target as HTMLInputElement).value;
    let sharesVal = parseFloat(valStr);
    
    if (isNaN(sharesVal) || sharesVal < 0) sharesVal = 0;
    const clampedShares = Math.min(tx.quantity, sharesVal);

    // Auto Proportional Cost Basis
    let calculatedCost = 0;
    if (tx.quantity > 0) {
      calculatedCost = parseFloat(((clampedShares / tx.quantity) * tx.totalAmount).toFixed(2));
    }

    this.service.updateTransactionAllocation(tx.id, clampedShares, calculatedCost);
  }



  public getSharePct(tx: Transaction, owner: 'A' | 'B'): number {
    if (tx.quantity === 0) return owner === 'A' ? 100 : 0;
    const shares = owner === 'A' ? tx.personAShares : tx.personBShares;
    return (shares / tx.quantity) * 100;
  }

  public async deleteTx(id: string) {
    const ok = await this.service.showConfirm('Delete Transaction', 'Are you sure you want to delete this transaction?');
    if (ok) {
      this.service.deleteTransaction(id);
      if (this.expandedTxId() === id) {
        this.expandedTxId.set(null);
      }
      this.service.showToast('Transaction deleted successfully.', 'info');
    }
  }

  public async clearAllTransactions() {
    const ok = await this.service.showConfirm(
      'Clear All Ledger Data',
      'WARNING: Are you sure you want to delete ALL transactions in the ledger? This action is irreversible.'
    );
    if (ok) {
      this.service.clearAllData();
      this.expandedTxId.set(null);
      this.service.showToast('All transactions cleared successfully.', 'info');
    }
  }

  public submitManualTx() {
    if (!this.newTx.ticker.trim()) {
      this.service.showToast('Error: Stock transactions require a ticker symbol.', 'error');
      return;
    }
    if (this.newTx.totalAmount <= 0) {
      if (this.newTx.quantity > 0 && this.newTx.price > 0) {
        this.newTx.totalAmount = this.newTx.quantity * this.newTx.price;
      } else {
        this.service.showToast('Error: Total Amount must be greater than 0.', 'error');
        return;
      }
    }

    const id = 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
    const createdTx: Transaction = {
      id,
      date: new Date(this.newTx.date).toISOString(),
      ticker: this.newTx.ticker.toUpperCase().trim(),
      type: this.newTx.type,
      quantity: this.newTx.quantity,
      price: this.newTx.price || (this.newTx.quantity > 0 ? (this.newTx.totalAmount / this.newTx.quantity) : 0),
      totalAmount: this.newTx.totalAmount,
      currency: this.newTx.currency.toUpperCase().trim() || 'USD',
      fxRate: this.newTx.fxRate || 1.0,
      source: this.newTxSource.trim() || 'Manual Entries',
      personBShares: 0,
      personBCostBasis: 0,
      personAShares: this.newTx.quantity,
      personACostBasis: this.newTx.totalAmount,
      manualAllocation: false,
      fees: this.newTx.fees || 0,
    };

    this.service.addTransactions([createdTx]);

    // Reset Form
    this.newTx = {
      date: this.getLocalDateString(),
      ticker: '',
      type: 'BUY',
      quantity: 0,
      price: 0,
      totalAmount: 0,
      currency: 'USD',
      fxRate: 1.0,
      fees: 0,
    };
    this.showAddForm.set(false);
  }

  private getLocalDateString(): string {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, 16);
    return localISOTime;
  }

  public isSourceDisabled(source: string): boolean {
    return this.service.disabledSources().includes(source);
  }

  public toggleSourceDisabled(source: string) {
    const current = this.service.disabledSources();
    if (current.includes(source)) {
      this.service.disabledSources.set(current.filter(s => s !== source));
      this.service.showToast(`Enabled account: ${source}`, 'success');
    } else {
      this.service.disabledSources.set([...current, source]);
      this.service.showToast(`Disabled account: ${source}`, 'info');
    }
    this.service.saveToStorage();
  }

  public deleteAccount(source: string) {
    const count = this.service.transactions().filter(tx => (tx.source || 'Manual Entries') === source).length;
    if (confirm(`Delete all ${count} transactions from "${source}"? This cannot be undone.`)) {
      const remaining = this.service.transactions().filter(tx => (tx.source || 'Manual Entries') !== source);
      this.service.transactions.set(remaining);
      // Also remove from disabled sources if it was there
      this.service.disabledSources.set(this.service.disabledSources().filter(s => s !== source));
      this.service.saveToStorage();
      this.service.showToast(`Deleted ${count} transactions from "${source}"`, 'success');
    }
  }

  public trackByAccount(index: number, item: any): string {
    return item.name;
  }

  public trackByTx(index: number, item: any): string {
    return item.id;
  }
}
