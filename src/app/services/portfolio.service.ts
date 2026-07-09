import { Injectable, signal, computed } from '@angular/core';
import { Transaction } from '../models/transaction.model';
import { MappingTemplate } from '../models/mapping-template.model';
import { TickerConfig } from '../models/ticker-config.model';
import { PortfolioPosition } from '../models/portfolio-position.model';
import { PersonPortfolioSummary } from '../models/portfolio-summary.model';


@Injectable({
  providedIn: 'root',
})
export class PortfolioService {
  // Signals for state
  public transactions = signal<Transaction[]>([]);
  public templates = signal<MappingTemplate[]>([]);
  public tickerConfigs = signal<Record<string, TickerConfig>>({});
  public exchangeRates = signal<Record<string, number>>({});
  public dateFrom = signal<string>('');
  public dateTo = signal<string>('');
  public dateFormat = signal<string>('MMMM d, yyyy');

  public useProperSectors = signal<boolean>(false);

  // Predefined map of sectors for autodiscovery
  public sectorMap: Record<string, string> = {
    // Tech (Mag 7)
    'AAPL': 'Tech (Mag 7)',
    'MSFT': 'Tech (Mag 7)',
    'GOOG': 'Tech (Mag 7)',
    'GOOGL': 'Tech (Mag 7)',
    'META': 'Tech (Mag 7)',
    'AMZN': 'Tech (Mag 7)',
    'TSLA': 'Tech (Mag 7)',
    'NFLX': 'Tech (Mag 7)',

    // Chips
    'NVDA': 'Chips',
    'AMD': 'Chips',
    'TSM': 'Chips',
    'ASML': 'Chips',
    'AVGO': 'Chips',
    'WDC': 'Chips',
    'SNDK': 'Chips',
    'MU': 'Chips',
    'INTC': 'Chips',
    'QCOM': 'Chips',
    'SECO': 'Chips',
    'SEC0': 'Chips',
    'SKHY': 'Chips',

    // AI
    'PLTR': 'AI',

    // SaaS
    'NOW': 'SaaS',
    'CRM': 'SaaS',

    // ETFs
    'VUAA': 'ETFs',
    'I500': 'ETFs',
    'SPY': 'ETFs',
    'VOO': 'ETFs',
    'QQQ': 'ETFs',
    'IVV': 'ETFs',
    'VTI': 'ETFs',

    // SPAC
    'SPCX': 'SPAC',

    // Consumer
    'COKE': 'Consumer',
    'ELF': 'Consumer',
    'KO': 'Consumer',
    'PEP': 'Consumer',
    'WMT': 'Consumer',
    'DIS': 'Consumer',

    // Financials
    'JPM': 'Financials',
    'BAC': 'Financials',
    'WFC': 'Financials',
    'MS': 'Financials',
    'GS': 'Financials',
    'V': 'Financials',
    'MA': 'Financials',
    'PYPL': 'Financials',
    'SOFI': 'Financials',
    'DB': 'Financials',
    'CS': 'Financials',
    'T': 'Financials',
    'VZ': 'Financials',
  };

  // Predefined map of company names for autodiscovery
  public companyNameMap: Record<string, string> = {
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corporation',
    'GOOG': 'Alphabet Inc. (Class C)',
    'GOOGL': 'Alphabet Inc. (Class A)',
    'META': 'Meta Platforms, Inc.',
    'AMZN': 'Amazon.com, Inc.',
    'TSLA': 'Tesla, Inc.',
    'NFLX': 'Netflix, Inc.',
    'NVDA': 'NVIDIA Corporation',
    'AMD': 'Advanced Micro Devices, Inc.',
    'TSM': 'Taiwan Semiconductor Manufacturing',
    'ASML': 'ASML Holding N.V.',
    'AVGO': 'Broadcom Inc.',
    'WDC': 'Western Digital Corporation',
    'SNDK': 'SanDisk Corporation',
    'MU': 'Micron Technology, Inc.',
    'INTC': 'Intel Corporation',
    'QCOM': 'Qualcomm Incorporated',
    'SECO': 'SECO S.p.A.',
    'SEC0': 'SECO S.p.A.',
    'SKHY': 'SK Hynix, Inc.',
    'PLTR': 'Palantir Technologies Inc.',
    'NOW': 'ServiceNow, Inc.',
    'CRM': 'Salesforce, Inc.',
    'VUAA': 'Vanguard S&P 500 UCITS ETF',
    'I500': 'iShares S&P 500 UCITS ETF',
    'SPY': 'SPDR S&P 500 ETF Trust',
    'VOO': 'Vanguard S&P 500 ETF',
    'QQQ': 'Invesco QQQ Trust',
    'IVV': 'iShares Core S&P 500 ETF',
    'VTI': 'Vanguard Total Stock Market ETF',
    'SPCX': 'The SPAC and New Issue ETF',
    'COKE': 'Coca-Cola Consolidated, Inc.',
    'ELF': 'e.l.f. Beauty, Inc.',
    'KO': 'The Coca-Cola Company',
    'PEP': 'PepsiCo, Inc.',
    'WMT': 'Walmart Inc.',
    'DIS': 'The Walt Disney Company',
    'JPM': 'JPMorgan Chase & Co.',
    'BAC': 'Bank of America Corporation',
    'WFC': 'Wells Fargo & Company',
    'MS': 'Morgan Stanley',
    'GS': 'The Goldman Sachs Group, Inc.',
    'V': 'Visa Inc.',
    'MA': 'Mastercard Incorporated',
    'PYPL': 'PayPal Holdings, Inc.',
    'SOFI': 'SoFi Technologies, Inc.',
    'DB': 'Deutsche Bank AG',
    'CS': 'Credit Suisse Group AG',
    'T': 'AT&T Inc.',
    'VZ': 'Verizon Communications Inc.',
  };

  public getTickerSector(ticker: string, storedSector?: string): string {
    const tUpper = ticker.replace(/\..*$/, '').toUpperCase().trim();
    if (!this.useProperSectors()) {
      return this.sectorMap[tUpper] || 'Other';
    }
    return storedSector || this.tickerConfigs()[tUpper]?.sector || 'Other';
  }

  public getTickerName(ticker: string, storedName?: string): string {
    const tUpper = ticker.replace(/\..*$/, '').toUpperCase().trim();
    if (!this.useProperSectors()) {
      return this.companyNameMap[tUpper] || ticker;
    }
    return storedName || this.tickerConfigs()[tUpper]?.name || ticker;
  }

  public getLogoData(ticker: string): string {
    const clean = ticker.toUpperCase().trim();
    const config = this.tickerConfigs()[clean];
    if (config?.logoData) {
      return config.logoData;
    }
    return `https://images.financialmodelingprep.com/symbol/${clean.split('.')[0]}.png`;
  }

  public cleanTickerConfigs() {
    const active = new Set(this.allTickers().map(t => t.toUpperCase()));
    const configs = { ...this.tickerConfigs() };
    let changed = false;
    Object.keys(configs).forEach((t) => {
      if (!active.has(t)) {
        delete configs[t];
        changed = true;
      }
    });
    if (changed) {
      this.tickerConfigs.set(configs);
      this.saveToStorage();
    }
  }
  
  // Names of the two portfolio owners
  public personAName = signal<string>('Person A');
  public personBName = signal<string>('Person B');
  public showNameColumn = signal<boolean>(false);
  public showNameHoldings = signal<boolean>(false);
  public showNameRealized = signal<boolean>(false);
  public showNameTransactions = signal<boolean>(false);

  constructor() {
    this.loadFromStorage();
    this.cleanTickerConfigs();
    if (localStorage.getItem('pt_transactions') === null) {
      this.loadMockData();
    }
    


    if (this.templates().length === 0) {
      this.templates.set([
        {
          name: 'Trading212 Export',
          delimiter: ',',
          hasHeader: true,
          mappings: { date: 0, ticker: 3, type: 1, quantity: 5, price: 6, totalAmount: 9, currency: 7, fxRate: 10 }
        },
        {
          name: 'Revolut Statement',
          delimiter: ',',
          hasHeader: true,
          mappings: { date: 0, ticker: 1, type: 2, quantity: 3, price: 4, totalAmount: 5, currency: 6, fxRate: 7 }
        }
      ]);
      this.saveToStorage();
    }
  }

  public sanitizeTransactions(list: Transaction[]): Transaction[] {
    return list.map(tx => {
      if (tx.ticker && (tx.type === 'BUY' || tx.type === 'SELL')) {
        const expectedTotal = tx.quantity * tx.price;
        if (expectedTotal > 0 && tx.totalAmount > 0) {
          const diffPct = Math.abs(tx.totalAmount - expectedTotal) / expectedTotal;
          if (diffPct > 0.02) { // Currency mismatch detected (> 2%)
            const ratio = expectedTotal / tx.totalAmount;
            return {
              ...tx,
              totalAmount: parseFloat(expectedTotal.toFixed(2)),
              personACostBasis: parseFloat((tx.personACostBasis * ratio).toFixed(2)),
              personBCostBasis: parseFloat((tx.personBCostBasis * ratio).toFixed(2)),
              fxRate: tx.fxRate && tx.fxRate !== 1.0 ? tx.fxRate : parseFloat((1 / ratio).toFixed(4))
            };
          }
        }
      }
      return tx;
    });
  }

  public loadFromStorage() {
    try {
      const txs = localStorage.getItem('pt_transactions');
      if (txs) {
        let list = JSON.parse(txs) as Transaction[];
        
        // Migrate legacy database values to version 2.0 (transaction currency standard)
        const dbVersion = localStorage.getItem('pt_db_version');
        if (dbVersion !== '2.0') {
          list = list.map(tx => {
            if (tx.fxRate && tx.fxRate > 0.0001 && tx.fxRate !== 1.0 && tx.ticker) {
              const newTotal = parseFloat((tx.totalAmount / tx.fxRate).toFixed(2));
              const newBCost = parseFloat((tx.personBCostBasis / tx.fxRate).toFixed(2));
              const newACost = parseFloat((tx.personACostBasis / tx.fxRate).toFixed(2));
              return {
                ...tx,
                totalAmount: newTotal,
                personBCostBasis: newBCost,
                personACostBasis: newACost
              };
            }
            return tx;
          });
        }
        
        const sanitized = this.sanitizeTransactions(list);
        this.transactions.set(sanitized);
        
        if (JSON.stringify(list) !== JSON.stringify(sanitized) || dbVersion !== '2.0') {
          localStorage.setItem('pt_transactions', JSON.stringify(sanitized));
          localStorage.setItem('pt_db_version', '2.0');
        }
      }
      const tmpl = localStorage.getItem('pt_templates');
      if (tmpl) this.templates.set(JSON.parse(tmpl));

      let meta = localStorage.getItem('pt_ticker_configs');
      if (!meta) {
        meta = localStorage.getItem('pt_ticker_meta');
      }
      if (meta) this.tickerConfigs.set(JSON.parse(meta));

      const pA = localStorage.getItem('pt_person_a_name');
      if (pA) this.personAName.set(pA);

      const pB = localStorage.getItem('pt_person_b_name');
      if (pB) this.personBName.set(pB);

      const df = localStorage.getItem('pt_date_format');
      if (df) this.dateFormat.set(df);

      const snc = localStorage.getItem('pt_show_name_column');
      if (snc) this.showNameColumn.set(snc === 'true');

      const snh = localStorage.getItem('pt_show_name_holdings');
      if (snh) this.showNameHoldings.set(snh === 'true');

      const snr = localStorage.getItem('pt_show_name_realized');
      if (snr) this.showNameRealized.set(snr === 'true');

      const snt = localStorage.getItem('pt_show_name_transactions');
      if (snt) this.showNameTransactions.set(snt === 'true');

      const savedRates = localStorage.getItem('pt_exchange_rates');
      if (savedRates) {
        this.exchangeRates.set(JSON.parse(savedRates));
      } else {
        const defaults = {
          'EUR/USD': 1.14,
          'USD/EUR': 0.8772,
          'GBP/USD': 1.28,
          'USD/GBP': 0.78,
          'EUR/GBP': 0.85,
          'GBP/EUR': 1.18
        };
        this.exchangeRates.set(defaults);
        localStorage.setItem('pt_exchange_rates', JSON.stringify(defaults));
      }
      const ups = localStorage.getItem('pt_use_proper_sectors');
      if (ups) this.useProperSectors.set(ups === 'true');
    } catch (e) {
      console.error('Failed to load portfolio tracker data from localStorage', e);
    }
  }

  public saveToStorage() {
    localStorage.setItem('pt_transactions', JSON.stringify(this.transactions()));
    localStorage.setItem('pt_templates', JSON.stringify(this.templates()));
    localStorage.setItem('pt_ticker_configs', JSON.stringify(this.tickerConfigs()));
    localStorage.setItem('pt_exchange_rates', JSON.stringify(this.exchangeRates()));
    localStorage.setItem('pt_use_proper_sectors', this.useProperSectors().toString());

    localStorage.setItem('pt_person_a_name', this.personAName());
    localStorage.setItem('pt_person_b_name', this.personBName());
    localStorage.setItem('pt_date_format', this.dateFormat());
    localStorage.setItem('pt_show_name_column', this.showNameColumn().toString());
    localStorage.setItem('pt_show_name_holdings', this.showNameHoldings().toString());
    localStorage.setItem('pt_show_name_realized', this.showNameRealized().toString());
    localStorage.setItem('pt_show_name_transactions', this.showNameTransactions().toString());
    localStorage.setItem('pt_db_version', '2.0');
  }

  // Update a single transaction allocation and recalculate shares
  public updateTransactionAllocation(txId: string, personBShares: number, personBCostBasis: number) {
    this.transactions.update((txs) => {
      const updated = txs.map((tx) => {
        if (tx.id === txId) {
          const clampedBShares = Math.min(tx.quantity, Math.max(0, personBShares));
          const clampedBCost = Math.min(tx.totalAmount, Math.max(0, personBCostBasis));
          return {
            ...tx,
            personBShares: clampedBShares,
            personBCostBasis: clampedBCost,
            personAShares: parseFloat((tx.quantity - clampedBShares).toFixed(6)),
            personACostBasis: parseFloat((tx.totalAmount - clampedBCost).toFixed(2)),
            manualAllocation: true,
          };
        }
        return tx;
      });
      return this.sanitizeTransactions(updated);
    });
    this.saveToStorage();
  }

  // Add / Edit / Delete Transactions
  public addTransactions(newTxs: Transaction[]) {
    this.transactions.update((prev) => {
      const merged = [...prev, ...newTxs];
      // Sort chronologically by date
      const sorted = merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      return this.sanitizeTransactions(sorted);
    });
    this.saveToStorage();
  }

  private getTransactionSignatureCandidates(tx: Transaction): string[] {
    // Robust date extractor to avoid timezone shifting
    let d = '';
    if (tx.date) {
      const match = tx.date.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
      if (match) {
        d = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      } else {
        try {
          const dateObj = new Date(tx.date);
          if (!isNaN(dateObj.getTime())) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            d = `${year}-${month}-${day}`;
          } else {
            d = tx.date.slice(0, 10);
          }
        } catch (e) {
          d = tx.date.slice(0, 10);
        }
      }
    }

    const ticker = (tx.ticker || '').toUpperCase().trim();
    const type = (tx.type || '').toUpperCase().trim();
    const currency = (tx.currency || '').toUpperCase().trim();
    const source = (tx.source || '').toLowerCase().trim();

    const qtyNum = Number(tx.quantity || 0);
    const priceNum = Number(tx.price || 0);
    const amountNum = Number(tx.totalAmount || 0);

    const candidates: string[] = [];

    // Candidate 1: New format (4 decimals for qty/price, 2 decimals for amount)
    const qty1 = qtyNum.toFixed(4);
    const price1 = priceNum.toFixed(4);
    const amount1 = amountNum.toFixed(2);
    candidates.push(`${d}_${ticker}_${type}_${qty1}_${price1}_${amount1}_${currency}_${source}`);

    // Candidate 2: Legacy raw format (no decimal padding for qty/price, 2 decimals for amount)
    const qty2 = qtyNum.toString();
    const price2 = priceNum.toString();
    const amount2 = amountNum.toFixed(2);
    candidates.push(`${d}_${ticker}_${type}_${qty2}_${price2}_${amount2}_${currency}_${source}`);

    // Candidate 3: Legacy raw format with raw amount
    const amount3 = amountNum.toString();
    candidates.push(`${d}_${ticker}_${type}_${qty2}_${price2}_${amount3}_${currency}_${source}`);

    // Candidate 4: Try 4 decimals for qty/price but raw amount
    candidates.push(`${d}_${ticker}_${type}_${qty1}_${price1}_${amount3}_${currency}_${source}`);

    return candidates;
  }

  public getTransactionSignature(tx: Transaction): string {
    return this.getTransactionSignatureCandidates(tx)[0];
  }

  private cacheSplits(txs: Transaction[]) {
    try {
      const stored = localStorage.getItem('pt_splits_cache');
      const cache: Record<string, { personBShares: number; personBCostBasis: number; manualAllocation: boolean }> = stored ? JSON.parse(stored) : {};
      
      txs.forEach(tx => {
        if (tx.personBShares > 0 || tx.manualAllocation) {
          const sig = this.getTransactionSignature(tx);
          cache[sig] = {
            personBShares: tx.personBShares,
            personBCostBasis: tx.personBCostBasis,
            manualAllocation: tx.manualAllocation
          };
        }
      });
      
      localStorage.setItem('pt_splits_cache', JSON.stringify(cache));
    } catch (e) {
      console.error('Failed to cache splits', e);
    }
  }

  public getCachedSplitsForTransactions(txs: Transaction[]): Record<string, { personBShares: number; personBCostBasis: number; manualAllocation: boolean }> {
    const matches: Record<string, { personBShares: number; personBCostBasis: number; manualAllocation: boolean }> = {};
    try {
      const stored = localStorage.getItem('pt_splits_cache');
      if (!stored) return matches;
      
      const cache: Record<string, { personBShares: number; personBCostBasis: number; manualAllocation: boolean }> = JSON.parse(stored);
      txs.forEach(tx => {
        const sigs = this.getTransactionSignatureCandidates(tx);
        const matchedSig = sigs.find(s => cache[s] !== undefined);
        if (matchedSig && cache[matchedSig]) {
          matches[tx.id] = cache[matchedSig];
        }
      });
    } catch (e) {
      console.error('Failed to get cached splits', e);
    }
    return matches;
  }

  public deleteTransaction(id: string) {
    const tx = this.transactions().find(t => t.id === id);
    if (tx) {
      this.cacheSplits([tx]);
    }
    this.transactions.update((prev) => prev.filter((tx) => tx.id !== id));
    this.saveToStorage();
  }

  public clearAllData() {
    this.cacheSplits(this.transactions());
    this.transactions.set([]);
    this.tickerConfigs.set({});
    this.saveToStorage();
  }

  // Manage Ticker Configs
  public updateTickerConfig(ticker: string, currentPrice: number, sector: string, name: string = '', priceCurrency?: string, logoData?: string) {
    const cleanTicker = ticker.replace(/\..*$/, '').toUpperCase().trim();
    const finalSector = sector || 'Other';

    const prev = this.tickerConfigs();
    // Preserve existing priceCurrency if not explicitly provided
    const existingCurrency = prev[ticker.toUpperCase()]?.priceCurrency;
    const finalCurrency = priceCurrency || existingCurrency || this.getTickerCurrency(ticker);
    const existingLogo = prev[ticker.toUpperCase()]?.logoData;
    const finalLogo = logoData || existingLogo;

    this.tickerConfigs.update((p) => ({
      ...p,
      [ticker.toUpperCase()]: {
        ticker: ticker.toUpperCase(),
        currentPrice: parseFloat(currentPrice as any) || 0,
        priceCurrency: finalCurrency,
        sector: finalSector,
        name: name || p[ticker.toUpperCase()]?.name || ticker,
        logoData: finalLogo
      },
    }));
    this.saveToStorage();
  }



  // Mapping Templates
  public saveTemplate(template: MappingTemplate) {
    this.templates.update((prev) => {
      const filtered = prev.filter((t) => t.name !== template.name);
      return [...filtered, template];
    });
    this.saveToStorage();
  }

  public deleteTemplate(name: string) {
    this.templates.update((prev) => prev.filter((t) => t.name !== name));
    this.saveToStorage();
  }

  // Clean raw pasted data into lines and cells
  public parseRawText(text: string, delimiter: string = '\t'): string[][] {
    if (!text.trim()) return [];
    
    return text.split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === delimiter && !inQuotes) {
            result.push(current.trim().replace(/^["']|["']$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim().replace(/^["']|["']$/g, ''));
        return result;
      });
  }

  public allTickers = computed(() => {
    const txs = this.transactions();
    const tickers = new Set<string>();
    txs.forEach((t) => {
      if (t.ticker) tickers.add(t.ticker.toUpperCase().trim());
    });
    return Array.from(tickers);
  });

  public getExchangeRate(from: string, to: string): number {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return 1.0;
    
    // Check if there is a dynamic ticker price for this currency pair in settings prices.
    const meta = this.tickerConfigs();
    const getTickerPrice = (base: string, quote: string): number | null => {
      const keys = [
        `${base}${quote}`,
        `${base}/${quote}`,
        `${base}${quote}=X`,
        `${base}-${quote}`
      ];
      for (const key of keys) {
        if (meta[key] && meta[key].currentPrice > 0) {
          return meta[key].currentPrice;
        }
      }
      return null;
    };

    // Try direct pair first
    const directRate = getTickerPrice(f, t);
    if (directRate !== null) {
      return directRate;
    }

    // Try inverse pair next
    const inverseRate = getTickerPrice(t, f);
    if (inverseRate !== null && inverseRate > 0) {
      return 1.0 / inverseRate;
    }
    
    // Hardcoded fallback rates: 1 USD = 0.8772 EUR (so 1 EUR = 1.14 USD)
    const usdToEur = 0.8772;
    const eurToUsd = 1.14;
    
    // If we have GBP, 1 USD = 0.78 GBP (so 1 GBP = 1.28 USD)
    const usdToGbp = 0.78;
    const gbpToUsd = 1.28;
    
    if (f === 'USD' && t === 'EUR') return usdToEur;
    if (f === 'EUR' && t === 'USD') return eurToUsd;
    if (f === 'USD' && t === 'GBP') return usdToGbp;
    if (f === 'GBP' && t === 'USD') return gbpToUsd;
    
    // Fallbacks via USD
    let rateToUsd = 1.0;
    if (f === 'EUR') rateToUsd = eurToUsd;
    else if (f === 'GBP') rateToUsd = gbpToUsd;
    
    let rateFromUsd = 1.0;
    if (t === 'EUR') rateFromUsd = usdToEur;
    else if (t === 'GBP') rateFromUsd = usdToGbp;
    
    return rateToUsd * rateFromUsd;
  }

  public getAverageCost(ticker: string): number {
    const sA = this.portfolioA();
    const posA = sA.positions.find(p => p.ticker.toUpperCase() === ticker.toUpperCase());
    const sB = this.portfolioB();
    const posB = sB.positions.find(p => p.ticker.toUpperCase() === ticker.toUpperCase());
    
    const sharesA = posA?.totalShares || 0;
    const sharesB = posB?.totalShares || 0;
    const costA = (posA?.totalShares || 0) * (posA?.averageCost || 0);
    const costB = (posB?.totalShares || 0) * (posB?.averageCost || 0);
    
    const totalShares = sharesA + sharesB;
    return totalShares > 0 ? (costA + costB) / totalShares : 0;
  }

  // Portfolio calculations for Person A and Person B
  public portfolioA = computed(() => this.calculatePortfolioForOwner('A'));
  public portfolioB = computed(() => this.calculatePortfolioForOwner('B'));

  // Calculate portfolio details
  private calculatePortfolioForOwner(owner: 'A' | 'B'): PersonPortfolioSummary {
    const rawTxs = this.transactions();
    const from = this.dateFrom();
    const to = this.dateTo();
    // Read exchangeRates to register it as a reactive dependency —
    // ensures recompute whenever rates or prices are updated in Settings
    this.exchangeRates();
    const meta = this.tickerConfigs();
    
    const filteredTxs = rawTxs.filter(tx => {
      if (!tx.date) return false;
      const cleanDate = tx.date.slice(0, 10);
      if (from && cleanDate < from) return false;
      if (to && cleanDate > to) return false;
      return true;
    });

    // Sort transactions chronologically (oldest first). If dates are identical, BUY comes before SELL.
    const txs = [...filteredTxs].sort((a, b) => {
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (diff !== 0) return diff;
      
      const typeOrder = { 'BUY': 1, 'SELL': 2, 'DIVIDEND': 3 } as any;
      const orderA = typeOrder[a.type.toUpperCase()] || 9;
      const orderB = typeOrder[b.type.toUpperCase()] || 9;
      return orderA - orderB;
    });
    
    const positionsMap = new Map<string, {
      shares: number;
      totalCost: number; // in USD
      realizedProfit: number; // in USD
      realizedCost: number; // in USD
      dividends: number; // in USD
      currency: string;
      rateToUsd: number;
    }>();

    for (const tx of txs) {
      const ticker = tx.ticker.toUpperCase().trim();
      const isStock = ticker.length > 0;
      if (!isStock) continue;

      const sharesAllocated = owner === 'A' ? tx.personAShares : tx.personBShares;
      const costAllocated = owner === 'A' ? tx.personACostBasis : tx.personBCostBasis;
      
      // FX Rate translates Tx currency to Base (USD): Base = Tx * rateToUsd
      const rateToUsd = tx.currency.toUpperCase() === 'USD'
        ? 1.0
        : (tx.fxRate && tx.fxRate !== 1.0 ? tx.fxRate : this.getExchangeRate(tx.currency, 'USD'));

      const baseCost = costAllocated * rateToUsd;

      if (!positionsMap.has(ticker)) {
        positionsMap.set(ticker, { 
          shares: 0, 
          totalCost: 0, 
          realizedProfit: 0, 
          realizedCost: 0,
          dividends: 0, 
          currency: tx.currency || 'USD',
          rateToUsd: rateToUsd
        });
      }
      const pos = positionsMap.get(ticker)!;
      pos.rateToUsd = rateToUsd;

      if (tx.type.toUpperCase() === 'BUY') {
        if (sharesAllocated > 0) {
          pos.shares += sharesAllocated;
          pos.totalCost += baseCost;
        }
      } else if (tx.type.toUpperCase() === 'SELL') {
        if (sharesAllocated > 0) {
          const avgCostBeforeSell = pos.shares > 0 ? (pos.totalCost / pos.shares) : 0;
          const costOfSharesSold = sharesAllocated * avgCostBeforeSell;
          
          pos.shares = Math.max(0, pos.shares - sharesAllocated);
          pos.totalCost = Math.max(0, pos.totalCost - costOfSharesSold);

          const sellRevenueBase = baseCost;
          pos.realizedProfit += (sellRevenueBase - costOfSharesSold);
          pos.realizedCost += costOfSharesSold;
        }
      } else if (tx.type.toUpperCase() === 'DIVIDEND') {
        pos.dividends += baseCost;
      }
    }

    const positions: PortfolioPosition[] = [];
    let totalValue = 0;
    let totalCostBasis = 0;
    let totalUnrealized = 0;
    let totalRealized = 0;
    let totalDividends = 0;

    positionsMap.forEach((pos, ticker) => {
      if (pos.shares === 0 && pos.realizedProfit === 0 && pos.dividends === 0) return;

      // Look up this ticker's saved price/sector/name — or use empty defaults.
      // All fields are set dynamically: prices come from Yahoo or manual entry in Settings.
      const priceData = meta[ticker] || {
        ticker,
        currentPrice: 0,
        priceCurrency: '',
        sector: 'Other',
        name: ticker,
      };

      const averageCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0; // in USD

      // Determine which currency priceData.currentPrice is denominated in.
      // Priority: (1) saved priceCurrency from Yahoo refresh, (2) ledger-derived from fxRate.
      let storedPriceCurrency = priceData.priceCurrency;
      if (!storedPriceCurrency) {
        const tickerTxs = txs.filter(t => t.ticker.toUpperCase() === ticker);
        const allSameCurrency = tickerTxs.every(t =>
          !t.fxRate || t.fxRate === 1.0 || t.currency.toUpperCase() === 'USD'
        );
        storedPriceCurrency = allSameCurrency ? pos.currency : 'USD';
      }
      const liveRateToUsd = this.getExchangeRate(storedPriceCurrency, 'USD');

      const currentPriceNative = priceData.currentPrice || 0;
      const currentPriceUsd = currentPriceNative > 0
        ? currentPriceNative * liveRateToUsd
        : (pos.shares > 0 ? averageCost : 0); // fallback: cost basis per share (already in USD)
      
      const currentValue = pos.shares * currentPriceUsd; // in USD
      const unrealizedProfit = pos.shares > 0 ? currentValue - pos.totalCost : 0; // in USD
      const totalReturn = unrealizedProfit + pos.realizedProfit + pos.dividends; // in USD

      const resolvedName = this.getTickerName(ticker, priceData.name);
      const resolvedSector = this.getTickerSector(ticker, priceData.sector);

      const unrealizedReturnPct = pos.totalCost > 0 ? (unrealizedProfit / pos.totalCost) * 100 : 0;
      const realizedReturnPct = pos.realizedCost > 0 ? (pos.realizedProfit / pos.realizedCost) * 100 : 0;
      const totalReturnPct = (pos.totalCost + pos.realizedCost) > 0 ? (totalReturn / (pos.totalCost + pos.realizedCost)) * 100 : 0;

      positions.push({
        ticker,
        name: resolvedName,
        sector: resolvedSector,
        currency: pos.currency,
        totalShares: parseFloat(pos.shares.toFixed(6)),
        averageCost: parseFloat(averageCost.toFixed(4)),
        totalCost: parseFloat((pos.shares * averageCost).toFixed(2)),
        currentPrice: parseFloat(currentPriceUsd.toFixed(4)),
        currentValue: parseFloat(currentValue.toFixed(2)),
        unrealizedProfit: parseFloat(unrealizedProfit.toFixed(2)),
        realizedProfit: parseFloat(pos.realizedProfit.toFixed(2)),
        dividends: parseFloat(pos.dividends.toFixed(2)),
        totalReturn: parseFloat(totalReturn.toFixed(2)),
        unrealizedReturnPct: parseFloat(unrealizedReturnPct.toFixed(2)),
        realizedReturnPct: parseFloat(realizedReturnPct.toFixed(2)),
        totalReturnPct: parseFloat(totalReturnPct.toFixed(2)),
      });

      totalValue += currentValue;
      totalCostBasis += pos.shares * averageCost;
      totalUnrealized += unrealizedProfit;
      totalRealized += pos.realizedProfit;
      totalDividends += pos.dividends;
    });

    positions.sort((a, b) => b.currentValue - a.currentValue);

    const totalReturn = totalUnrealized + totalRealized + totalDividends;

    return {
      ownerName: owner === 'A' ? this.personAName() : this.personBName(),
      positions,
      totalValue: parseFloat(totalValue.toFixed(2)),
      totalCostBasis: parseFloat(totalCostBasis.toFixed(2)),
      totalUnrealized: parseFloat(totalUnrealized.toFixed(2)),
      totalRealized: parseFloat(totalRealized.toFixed(2)),
      totalDividends: parseFloat(totalDividends.toFixed(2)),
      totalReturn: parseFloat(totalReturn.toFixed(2)),
    };
  }

  private loadMockData() {
    this.personAName.set('Alex');
    this.personBName.set('Taylor');



    this.tickerConfigs.set({
      'SOFI': { ticker: 'SOFI', currentPrice: 18.38, priceCurrency: 'USD', sector: 'Financials', name: 'SoFi Technologies, Inc.' },
      'AAPL': { ticker: 'AAPL', currentPrice: 245.50, priceCurrency: 'USD', sector: 'Technology', name: 'Apple Inc.' },
      'TSLA': { ticker: 'TSLA', currentPrice: 220.15, priceCurrency: 'USD', sector: 'Consumer Cyclical', name: 'Tesla, Inc.' },
      'MSFT': { ticker: 'MSFT', currentPrice: 415.60, priceCurrency: 'USD', sector: 'Technology', name: 'Microsoft Corporation' },
      'NVDA': { ticker: 'NVDA', currentPrice: 125.80, priceCurrency: 'USD', sector: 'Technology', name: 'NVIDIA Corporation' },
    });

    const mockTxs: Transaction[] = [
      {
        id: 'tx-2',
        date: '2026-01-10T14:30:00Z',
        ticker: 'AAPL',
        type: 'BUY',
        quantity: 20,
        price: 220.00,
        totalAmount: 4400,
        currency: 'USD',
        fxRate: 1,
        source: 'Demo Broker 1',
        personBShares: 8,
        personBCostBasis: 1760,
        personAShares: 12,
        personACostBasis: 2640,
        manualAllocation: false,
      },
      {
        id: 'tx-3',
        date: '2026-01-15T15:00:00Z',
        ticker: 'SOFI',
        type: 'BUY',
        quantity: 125,
        price: 15.00,
        totalAmount: 1875,
        currency: 'USD',
        fxRate: 1,
        source: 'Demo Broker 1',
        personBShares: 30,
        personBCostBasis: 450,
        personAShares: 95,
        personACostBasis: 1425,
        manualAllocation: true,
      },
      {
        id: 'tx-4',
        date: '2026-02-01T10:15:00Z',
        ticker: 'TSLA',
        type: 'BUY',
        quantity: 15,
        price: 200.00,
        totalAmount: 3000,
        currency: 'USD',
        fxRate: 1,
        source: 'Demo Broker 2',
        personBShares: 7.5,
        personBCostBasis: 1500,
        personAShares: 7.5,
        personACostBasis: 1500,
        manualAllocation: false,
      },
      {
        id: 'tx-5',
        date: '2026-02-12T16:00:00Z',
        ticker: 'MSFT',
        type: 'BUY',
        quantity: 10,
        price: 400.00,
        totalAmount: 4000,
        currency: 'USD',
        fxRate: 1,
        source: 'Demo Broker 1',
        personBShares: 0,
        personBCostBasis: 0,
        personAShares: 10,
        personACostBasis: 4000,
        manualAllocation: false,
      },
      {
        id: 'tx-6',
        date: '2026-02-20T15:30:00Z',
        ticker: 'NVDA',
        type: 'BUY',
        quantity: 40,
        price: 110.00,
        totalAmount: 4400,
        currency: 'USD',
        fxRate: 1,
        source: 'Demo Broker 2',
        personBShares: 40,
        personBCostBasis: 4400,
        personAShares: 0,
        personACostBasis: 0,
        manualAllocation: false,
      },
      {
        id: 'tx-7',
        date: '2026-03-01T08:00:00Z',
        ticker: 'AAPL',
        type: 'DIVIDEND',
        quantity: 0,
        price: 0.25,
        totalAmount: 5.00,
        currency: 'USD',
        fxRate: 1,
        source: 'Demo Broker 1',
        personBShares: 0,
        personBCostBasis: 2.00,
        personAShares: 0,
        personACostBasis: 3.00,
        manualAllocation: false,
      },
      {
        id: 'tx-8',
        date: '2026-03-10T14:00:00Z',
        ticker: 'TSLA',
        type: 'SELL',
        quantity: 5,
        price: 230.00,
        totalAmount: 1150,
        currency: 'USD',
        fxRate: 1,
        source: 'Demo Broker 2',
        personBShares: 2.5,
        personBCostBasis: 575,
        personAShares: 2.5,
        personACostBasis: 575,
        manualAllocation: false,
      }
    ];

    this.transactions.set(mockTxs);
    this.saveToStorage();
  }

  // UI Dialog & Toast State
  public toasts = signal<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);
  public confirmModal = signal<{
    title: string;
    message: string;
    resolve: (value: boolean) => void;
  } | null>(null);
  
  public alertModal = signal<{
    title: string;
    message: string;
    resolve: () => void;
  } | null>(null);

  public showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    const id = 'toast-' + Math.random().toString(36).substring(2, 9);
    this.toasts.update((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      this.toasts.update((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }

  public showConfirm(title: string, message: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.confirmModal.set({
        title,
        message,
        resolve,
      });
    });
  }

  public showAlert(title: string, message: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.alertModal.set({
        title,
        message,
        resolve: () => {
          this.alertModal.set(null);
          resolve();
        }
      });
    });
  }

  public failedLogos = signal<Set<string>>(new Set());

  public onLogoError(ticker: string) {
    if (!ticker) return;
    const clean = ticker.split('.')[0].toUpperCase().trim();
    this.failedLogos.update((prev) => {
      const next = new Set(prev);
      next.add(clean);
      return next;
    });
  }

  public shouldShowPlaceholder(ticker: string): boolean {
    if (!ticker) return true;
    const clean = ticker.split('.')[0].toUpperCase().trim();
    return this.failedLogos().has(clean);
  }

  public getTickerColor(ticker: string): string {
    if (!ticker) return 'linear-gradient(135deg, #4f46e5, #06b6d4)';
    const clean = ticker.split('.')[0].toUpperCase().trim();
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = clean.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      'linear-gradient(135deg, #3b82f6, #1d4ed8)', // Blue
      'linear-gradient(135deg, #10b981, #047857)', // Green
      'linear-gradient(135deg, #ec4899, #be185d)', // Pink
      'linear-gradient(135deg, #f59e0b, #b45309)', // Amber
      'linear-gradient(135deg, #8b5cf6, #5b21b6)', // Purple
      'linear-gradient(135deg, #ef4444, #b91c1c)', // Red
      'linear-gradient(135deg, #06b6d4, #0891b2)', // Cyan
      'linear-gradient(135deg, #6366f1, #4338ca)', // Indigo
    ];
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  public hasLogo(ticker: string): boolean {
    if (!ticker) return false;
    const base = ticker.split('.')[0].toUpperCase().trim();
    return base.length > 0 && base !== 'CASH' && base !== 'DEPOSIT' && base !== 'WITHDRAWAL';
  }

  public getTickerCurrency(ticker: string): string {
    if (!ticker) return 'USD';
    const clean = ticker.replace(/\..*$/, '').toUpperCase().trim();
    const tx = this.transactions().find(t => t.ticker === clean);
    return tx ? tx.currency : 'USD';
  }

  // Query a free API to update current stock prices
  public async loadMarketPricesApi(force: boolean = false) {
    const tickers = this.allTickers();
    if (tickers.length === 0) {
      this.showToast('No tickers in transactions to fetch prices for.', 'info');
      return;
    }

    // Check 20-minute cache rate limit unless force is true
    const now = Date.now();
    const lastRefreshStr = localStorage.getItem('pt_last_refresh_time');
    if (!force && lastRefreshStr) {
      const lastRefresh = parseInt(lastRefreshStr, 10);
      const elapsedMs = now - lastRefresh;
      const cooldownMs = 20 * 60 * 1000; // 20 minutes
      
      if (elapsedMs < cooldownMs) {
        const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000);
        this.showToast(`Prices refreshed recently. Next update in ${remainingMinutes} min. Click 'Force Refresh' to update now.`, 'info');
        return;
      }
    }

    this.showToast('Fetching real-time market rates with autocomplete discovery...', 'info');

    try {
      let updatedCount = 0;
      const meta = this.tickerConfigs();

      // Query Yahoo search API first to autodiscover the exact symbol suffix
      const fetchWithSelfDiscovery = async (ticker: string): Promise<{ ticker: string, price: number, priceCurrency: string, sector?: string, name?: string, logoData?: string } | null> => {
        try {
          const cleanTicker = ticker.toUpperCase().trim();
          let resolvedSymbol = cleanTicker;
          let sector = 'Other';
          let name = cleanTicker;
          
          // ALWAYS run search lookup to dynamically discover resolved suffix, name, and sector
          const searchUrl = `https://corsproxy.io/?https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanTicker)}&nocache=${Date.now()}`;
          const searchResponse = await fetch(searchUrl, { cache: 'no-store' });
          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const quotes = searchData?.quotes || [];
            
            // Try to find the exact matching quote or default to first quote
            let quote = quotes.find((q: any) => q.symbol?.toUpperCase() === cleanTicker);
            if (!quote && quotes.length > 0) {
              quote = quotes[0];
            }
            
            if (quote) {
              resolvedSymbol = quote.symbol.toUpperCase();
              name = quote.longname || quote.shortname || cleanTicker;
              sector = quote.sector || 'Other';
            }
          }

          // Fetch price for the resolved symbol
          const cleanResolved = encodeURIComponent(resolvedSymbol);
          const chartUrl = `https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/${cleanResolved}?includePrePost=true&nocache=${Date.now()}`;
          
          const chartResponse = await fetch(chartUrl, { cache: 'no-store' });
          if (!chartResponse.ok) return null;
          
          const data = await chartResponse.json();
          const result = data?.chart?.result?.[0];
          const chartMeta = result?.meta;
          if (chartMeta) {
            // Retrieve last non-null close price
            const closes = result.indicators?.quote?.[0]?.close || [];
            let price = null;
            for (let i = closes.length - 1; i >= 0; i--) {
              if (closes[i] !== null && !isNaN(closes[i]) && closes[i] > 0) {
                price = parseFloat(closes[i]);
                break;
              }
            }
            if (price === null || isNaN(price) || price <= 0) {
              price = parseFloat(chartMeta.regularMarketPrice || chartMeta.chartPreviousClose);
            }

            let currency: string = (chartMeta.currency || 'USD').toUpperCase();
            if (!isNaN(price) && price > 0) {
              // Convert British pence to pounds
              if (currency === 'GBP' || chartMeta.currency === 'GBp') {
                if (chartMeta.currency === 'GBp') price = price / 100;
                currency = 'GBP';
              }

              // Dynamically fetch and cache logo image on first load
              let logoData: string | undefined = undefined;
              if (!meta[cleanTicker]?.logoData) {
                try {
                  const logoUrl = `https://corsproxy.io/?https://images.financialmodelingprep.com/symbol/${cleanTicker.split('.')[0]}.png`;
                  const res = await fetch(logoUrl);
                  if (res.ok) {
                    const blob = await res.blob();
                    logoData = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result as string);
                      reader.onerror = reject;
                      reader.readAsDataURL(blob);
                    });
                  }
                } catch (e) {
                  console.warn(`Failed to fetch logo for ${cleanTicker}:`, e);
                }
              } else {
                logoData = meta[cleanTicker].logoData;
              }
              
              return { ticker: cleanTicker, price, priceCurrency: currency, sector, name, logoData };
            }
          }
        } catch (e) {
          console.warn(`Failed to self-discover price/info for ${ticker}:`, e);
        }
        return null;
      };

      const promises = tickers.map(ticker => fetchWithSelfDiscovery(ticker));
      const results = await Promise.all(promises);
      
      results.forEach((res) => {
        if (res) {
          const ticker = res.ticker;
          const price = res.price;
          const current = meta[ticker] || {
            ticker,
            currentPrice: price,
            priceCurrency: res.priceCurrency || 'USD',
            sector: res.sector || 'Other',
            name: res.name || ticker,
            logoData: res.logoData
          };
          
          const finalSector = res.sector || current.sector || 'Other';
          const finalName = res.name || current.name || ticker;
          const finalLogo = res.logoData || current.logoData;
          
          this.updateTickerConfig(ticker, price, finalSector, finalName, res.priceCurrency, finalLogo);
          updatedCount++;
        }
      });

      if (updatedCount === 0) {
        throw new Error('All tickers failed to fetch');
      }

      // Save successful refresh timestamp
      localStorage.setItem('pt_last_refresh_time', Date.now().toString());
      this.showToast(`Successfully fetched real-time prices for ${updatedCount} tickers!`, 'success');

    } catch (err) {
      console.warn('Real-time fetch failed:', err);
      this.showToast('Real-time API fetch failed.', 'error');
      this.showAlert(
        'Real-time Fetch Failed',
        'We were unable to contact the Yahoo Finance API (rate-limiting or offline). Keeping last known prices.'
      );
    }
  }

  public async loadExchangeRatesApi(force: boolean = false) {
    const pairs = ['EUR/USD', 'USD/EUR', 'GBP/USD', 'USD/GBP', 'EUR/GBP', 'GBP/EUR'];
    const now = Date.now();
    const lastRefreshStr = localStorage.getItem('pt_last_rates_refresh_time');
    
    if (!force && lastRefreshStr) {
      const lastRefresh = parseInt(lastRefreshStr, 10);
      const elapsedMs = now - lastRefresh;
      const cooldownMs = 20 * 60 * 1000;
      
      if (elapsedMs < cooldownMs) {
        const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000);
        this.showToast(`Rates refreshed recently. Next update in ${remainingMinutes} min. Click 'Force Refresh' to update now.`, 'info');
        return;
      }
    }

    this.showToast('Fetching current exchange rates...', 'info');

    try {
      const updatedRates: Record<string, number> = { ...this.exchangeRates() };
      let updatedCount = 0;

      const fetchRate = async (pair: string): Promise<{ pair: string, price: number } | null> => {
        try {
          const parts = pair.split('/');
          const ticker = `${parts[0]}${parts[1]}=X`;
          const chartUrl = `https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
          
          const response = await fetch(chartUrl);
          if (response.ok) {
            const data = await response.json();
            const chartMeta = data?.chart?.result?.[0]?.meta;
            if (chartMeta) {
              const price = parseFloat(chartMeta.regularMarketPrice || chartMeta.chartPreviousClose);
              if (!isNaN(price) && price > 0) {
                return { pair, price };
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to fetch rate for ${pair}:`, e);
        }
        return null;
      };

      const promises = pairs.map(pair => fetchRate(pair));
      const results = await Promise.all(promises);
      
      results.forEach((res) => {
        if (res) {
          updatedRates[res.pair] = parseFloat(res.price.toFixed(6));
          updatedCount++;
        }
      });

      if (updatedCount > 0) {
        this.exchangeRates.set(updatedRates);
        this.saveToStorage();
        localStorage.setItem('pt_last_rates_refresh_time', Date.now().toString());
        this.showToast(`Successfully refreshed ${updatedCount} exchange rates!`, 'success');
      } else {
        throw new Error('All rates failed to fetch');
      }
    } catch (err) {
      console.warn('Exchange rates fetch failed:', err);
      this.showToast('Failed to fetch exchange rates.', 'error');
    }
  }
}
