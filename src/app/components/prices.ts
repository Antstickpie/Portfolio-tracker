import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioService } from '../services/portfolio.service';
import { TickerConfig } from '../models/ticker-config.model';

@Component({
  selector: 'app-prices',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prices.html',
  styleUrl: './prices.css'
})
export class PricesComponent {
  public service = inject(PortfolioService);

  public showAddMetaForm = signal(false);
  public isEditingRates = signal(false);
  public isRatesCollapsed = signal(false);
  public isPricesCollapsed = signal(false);
  public newCurrencyCode = '';

  public filterTicker = signal('');
  public sortBy = signal<string>('ticker');
  public sortDirection = signal<'asc' | 'desc'>('asc');

  constructor() {
    const savedBy = localStorage.getItem('pt_prices_sort_by');
    if (savedBy) this.sortBy.set(savedBy);

    const savedDir = localStorage.getItem('pt_prices_sort_dir');
    if (savedDir) this.sortDirection.set(savedDir as any);

    effect(() => { localStorage.setItem('pt_prices_sort_by', this.sortBy()); });
    effect(() => { localStorage.setItem('pt_prices_sort_dir', this.sortDirection()); });
  }

  public exchangeRatePairs = computed(() => {
    const rates = this.service.exchangeRates();
    return Object.entries(rates).map(([key, rate]) => ({
      key,
      name: key,
      rate
    }));
  });

  public getGoogleCurrencyUrl(pairKey: string): string {
    const parts = pairKey.split('/');
    if (parts.length === 2) {
      const from = parts[0].trim().toUpperCase();
      const to = parts[1].trim().toUpperCase();
      return `https://www.google.com/finance/quote/${from}-${to}`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(pairKey + ' exchange rate')}`;
  }

  public updateExchangeRate(key: string, rate: number) {
    if (!isNaN(rate) && rate > 0) {
      this.service.exchangeRates.update((prev) => {
        const updated = { ...prev, [key]: rate };
        
        // Auto-update inverse rate if it exists
        const parts = key.split('/');
        if (parts.length === 2) {
          const inverseKey = `${parts[1]}/${parts[0]}`;
          if (prev[inverseKey] !== undefined) {
            updated[inverseKey] = parseFloat((1.0 / rate).toFixed(6));
          }
        }
        return updated;
      });
      this.service.saveToStorage();
    }
  }


  public trackByIndex(index: number): number {
    return index;
  }

  public addPerson() {
    this.service.addPerson();
  }

  public updatePersonName(index: number, name: string) {
    this.service.updatePersonName(index, name);
  }

  public removePerson(index: number) {
    this.service.removePerson(index);
  }



  // Config form state
  public newConfig = {
    ticker: '',
    price: 0,
    sector: 'Technology',
    name: '',
  };

  // Convert Record map to list for view, merging in any unique tickers from transactions
  public tickerConfigsList = computed(() => {
    const meta = this.service.tickerConfigs();
    const allUnique = this.service.allTickers();
    
    // Filter out internal forex symbols (e.g. USDEUR=X, EUR/USD)
    const isForexSymbol = (t: string) => t.includes('=X') || /^[A-Z]{3}\/[A-Z]{3}$/.test(t);

    // Ensure all unique stock tickers present in transactions are displayed in the list
    const combinedTickers = Array.from(new Set([...allUnique, ...Object.keys(meta)]))
      .filter(t => !isForexSymbol(t.toUpperCase().trim()));
    
    return combinedTickers.map((ticker) => {
      const tUpper = ticker.toUpperCase();
      const stored = meta[tUpper] || {
        ticker: tUpper,
        currentPrice: 0,
        sector: 'Other',
        name: tUpper
      };
      
      const resolvedName = this.service.getTickerName(tUpper, stored.name);
      const resolvedSector = this.service.getTickerSector(tUpper, stored.sector);
        
      return {
        ...stored,
        name: resolvedName,
        sector: resolvedSector
      };
    });
  });

  public setSort(field: string) {
    if (this.sortBy() === field) {
      this.sortDirection.update((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      this.sortBy.set(field);
      this.sortDirection.set(field === 'currentPrice' ? 'desc' : 'asc');
    }
  }

  public formatTickerPrice(ticker: string, price: number): string {
    const currency = this.service.getTickerCurrency(ticker);
    const symbol = currency === 'USD' ? '$' : (currency === 'EUR' ? '€' : '£');
    return symbol + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  public filteredTickerConfigsList = computed(() => {
    const list = this.tickerConfigsList();
    const q = this.filterTicker().toUpperCase().trim();
    const filtered = q
      ? list.filter(m => m.ticker.includes(q) || (m.name || '').toUpperCase().includes(q))
      : list;
      
    const field = this.sortBy();
    const dir = this.sortDirection();
    
    return [...filtered].sort((a: any, b: any) => {
      let valA = a[field];
      let valB = b[field];
      
      if (typeof valA === 'string') {
        valA = valA.toUpperCase();
        valB = (valB || '').toUpperCase();
      }
      
      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  });



  public saveOwnerNames() {
    this.service.saveToStorage();
    this.service.showToast('Settings saved successfully!', 'success');
  }

  public async clearAllLedger() {
    const ok = await this.service.showConfirm(
      'Clear All Ledger Data',
      'WARNING: Are you sure you want to delete ALL transactions in the ledger? This action is irreversible.'
    );
    if (ok) {
      this.service.clearAllData();
      this.service.showToast('All transactions cleared successfully.', 'info');
    }
  }

  // Backup to JSON file
  public exportPortfolioBackup() {
    const data = this.service.buildLocalData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Restore from JSON file
  public importPortfolioBackup(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        
        // Restore DB Version to local storage before loading
        const backupDbVersion = data.dbVersion || data.version;
        if (backupDbVersion === '2.0') {
          localStorage.setItem('pt_db_version', '2.0');
        } else {
          localStorage.removeItem('pt_db_version');
        }

        // Apply all settings and records
        this.service.applyRemoteData(data);
        this.service.showToast('Backup restored successfully!', 'success');
        input.value = '';
      } catch (err) {
        this.service.showToast('Error parsing backup file. Make sure it is a valid portfolio tracker JSON backup.', 'error');
      }
    };
    reader.readAsText(file);
  }

  public submitMeta() {
    const t = this.newConfig.ticker.toUpperCase().trim();
    if (!t) {
      this.service.showToast('Error: Ticker symbol is required.', 'error');
      return;
    }

    this.service.updateTickerConfig(t, this.newConfig.price || 0, this.newConfig.sector, this.newConfig.name);
    
    // Reset Form
    this.newConfig = {
      ticker: '',
      price: 0,
      sector: 'Technology',
      name: '',
    };
    this.showAddMetaForm.set(false);
  }

  public updateTickerName(ticker: string, event: Event) {
    const val = (event.target as HTMLInputElement).value;
    const current = this.service.tickerConfigs()[ticker] || {
      ticker: ticker.toUpperCase(),
      currentPrice: this.service.getAverageCost(ticker) || 0,
      sector: 'Other',
      name: ticker.toUpperCase()
    };
    this.service.updateTickerConfig(ticker, current.currentPrice, current.sector, val);
  }


  public updateTickerPrice(ticker: string, event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      const current = this.service.tickerConfigs()[ticker] || {
        ticker: ticker.toUpperCase(),
        currentPrice: 0,
        sector: 'Other',
        name: ticker.toUpperCase()
      };
      this.service.updateTickerConfig(ticker, val, current.sector, current.name);
    }
  }

  public updateTickerSplitRatio(ticker: string, value: string) {
    const val = parseFloat(value);
    if (!isNaN(val) && val > 0) {
      const prev = this.service.tickerConfigs()[ticker] || {
        ticker: ticker.toUpperCase(),
        currentPrice: 0,
        sector: 'Other',
        name: ticker.toUpperCase()
      };
      this.service.updateTickerConfig(
        ticker,
        prev.currentPrice,
        prev.sector,
        prev.name,
        prev.priceCurrency,
        prev.logoData,
        prev.yahooSymbol,
        prev.customSector,
        val,
        prev.splitDate
      );
      this.service.saveToStorage();
      this.service.showToast(`Updated split ratio for ${ticker} to ${val}`, 'success');
    } else if (value === '') {
      const prev = this.service.tickerConfigs()[ticker];
      if (prev) {
        this.service.tickerConfigs.update((p) => {
          const updated = { ...p };
          delete updated[ticker.toUpperCase()].splitRatio;
          return updated;
        });
        this.service.saveToStorage();
        this.service.showToast(`Cleared split ratio for ${ticker}`, 'info');
      }
    }
  }

  public updateTickerSplitDate(ticker: string, value: string) {
    const prev = this.service.tickerConfigs()[ticker] || {
      ticker: ticker.toUpperCase(),
      currentPrice: 0,
      sector: 'Other',
      name: ticker.toUpperCase()
    };
    this.service.updateTickerConfig(
      ticker,
      prev.currentPrice,
      prev.sector,
      prev.name,
      prev.priceCurrency,
      prev.logoData,
      prev.yahooSymbol,
      prev.customSector,
      prev.splitRatio,
      value || undefined
    );
    if (!value) {
      this.service.tickerConfigs.update((p) => {
        const updated = { ...p };
        delete updated[ticker.toUpperCase()].splitDate;
        return updated;
      });
    }
    this.service.saveToStorage();
    this.service.showToast(`Updated split date for ${ticker} to ${value || 'none'}`, 'success');
  }

  public async deleteTickerConfig(ticker: string) {
    const ok = await this.service.showConfirm('Delete Ticker Price', `Delete price/sector data for ${ticker}?`);
    if (ok) {
      this.service.tickerConfigs.update((prev) => {
        const copy = { ...prev };
        delete copy[ticker];
        return copy;
      });
      this.service.saveToStorage();
      this.service.showToast(`Deleted pricing data for ${ticker}.`, 'info');
    }
  }

  // Query a free API to update current stock prices
  public async loadMarketPricesApi(force: boolean = false) {
    await this.service.loadMarketPricesApi(force);
  }

  public async loadExchangeRatesApi(force: boolean = false) {
    await this.service.loadExchangeRatesApi(force);
  }

  // Sector manager
  public newSectorName = '';

  public addSector() {
    const name = this.newSectorName.trim();
    if (!name) return;
    if (!this.service.customSectors().includes(name)) {
      this.service.customSectors.update(s => [...s, name]);
      this.service.saveToStorage();
    }
    this.newSectorName = '';
  }

  public removeSector(index: number) {
    this.service.customSectors.update(s => s.filter((_, i) => i !== index));
    this.service.saveToStorage();
  }


  public getMonthName(m: number): string {
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[m - 1] || '';
  }

  public getDaysArray(): number[] {
    const month = this.service.financialYearStartMonth();
    let len = 31;
    if (month === 2) len = 29;
    else if ([4, 6, 9, 11].includes(month)) len = 30;
    
    const arr = [];
    for (let i = 1; i <= len; i++) arr.push(i);
    return arr;
  }

  public addVisibleCurrency() {
    const code = this.newCurrencyCode.trim().toUpperCase();
    if (!code) return;
    
    if (!this.service.visibleCurrencies().includes(code)) {
      this.service.visibleCurrencies.update(c => [...c, code]);
      this.service.saveToStorage();
      this.service.loadExchangeRatesApi(true);
    }
    this.newCurrencyCode = '';
  }

  public removeVisibleCurrency(index: number) {
    const current = this.service.visibleCurrencies();
    if (current.length === 1) return;
    this.service.visibleCurrencies.update(c => c.filter((_, i) => i !== index));
    this.service.saveToStorage();
  }

  public updateTickerSector(ticker: string, sector: string) {
    const current = this.service.tickerConfigs()[ticker.toUpperCase()] || {
      ticker: ticker.toUpperCase(),
      currentPrice: 0,
      name: ticker.toUpperCase(),
      priceCurrency: 'USD',
      sector: 'Other'
    };
    this.service.updateTickerConfig(
      ticker,
      current.currentPrice,
      current.sector,
      current.name,
      current.priceCurrency,
      current.logoData,
      current.yahooSymbol,
      sector
    );
  }



  public updateTickerYahooSymbol(ticker: string, symbol: string) {
    const current = this.service.tickerConfigs()[ticker.toUpperCase()] || {
      ticker: ticker.toUpperCase(),
      currentPrice: 0,
      name: ticker.toUpperCase(),
      priceCurrency: 'USD',
      sector: 'Other',
      logoData: undefined
    };

    let finalSymbol = symbol.trim().toUpperCase();
    if (finalSymbol) {
      if (finalSymbol.startsWith('.')) {
        finalSymbol = ticker.toUpperCase() + finalSymbol;
      } else if (!finalSymbol.includes('.') && finalSymbol.length <= 4 && finalSymbol !== ticker.toUpperCase()) {
        finalSymbol = ticker.toUpperCase() + '.' + finalSymbol;
      }
    }

    this.service.updateTickerConfig(
      ticker,
      current.currentPrice,
      current.sector,
      current.name,
      current.priceCurrency,
      current.logoData,
      finalSymbol
    );
    this.service.showToast(`Updated Yahoo Symbol to ${finalSymbol || 'default'} for ${ticker.toUpperCase()}`, 'success');
  }

  public async searchYahooSymbol(ticker: string) {
    const selectedSymbol = await this.service.selectYahooSymbol(ticker);
    if (selectedSymbol) {
      this.updateTickerYahooSymbol(ticker, selectedSymbol);
    }
  }


  public formatSyncTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    try {
      return formatDate(timestamp, this.service.dateFormat(), 'en-US');
    } catch (e) {
      return new Date(timestamp).toLocaleDateString();
    }
  }

  public trackByTicker(index: number, item: any): string {
    return item.ticker;
  }

  public allSources = computed(() => {
    const srcs = new Set<string>();
    this.service.transactions().forEach(tx => {
      if (tx.source) srcs.add(tx.source);
    });
    return Array.from(srcs).sort();
  });

  public isSplitAdjusted(source: string): boolean {
    return this.service.splitAdjustedSources().includes(source);
  }

  public toggleSplitAdjusted(source: string) {
    const current = this.service.splitAdjustedSources();
    if (current.includes(source)) {
      this.service.splitAdjustedSources.set(current.filter(s => s !== source));
    } else {
      this.service.splitAdjustedSources.set([...current, source]);
    }
    this.service.saveToStorage();
  }

  public setCostBasisMethod(method: 'fifo' | 'avg') {
    this.service.costBasisMethod.set(method);
    this.service.saveToStorage();
  }
}
