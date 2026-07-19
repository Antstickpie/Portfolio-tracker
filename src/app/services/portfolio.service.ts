import { Injectable, signal, computed, effect, untracked } from '@angular/core';
import { Transaction } from '../models/transaction.model';
import { MappingTemplate } from '../models/mapping-template.model';
import { TickerConfig } from '../models/ticker-config.model';
import { PortfolioPosition } from '../models/portfolio-position.model';
import { PersonPortfolioSummary } from '../models/portfolio-summary.model';

declare var google: any;

@Injectable({
  providedIn: 'root',
})
export class PortfolioService {
  // Signals for state
  public transactions = signal<Transaction[]>([]);
  public templates = signal<MappingTemplate[]>([]);
  public tickerConfigs = signal<Record<string, TickerConfig>>({});
  public exchangeRates = signal<Record<string, number>>({});
  public historicalPrices = signal<Record<string, Record<string, number>>>({});
  public visibleCurrencies = signal<string[]>(['EUR', 'USD']);
  public customSectors = signal<string[]>(['Technology', 'Financials', 'Healthcare', 'Consumer', 'Energy', 'Industrials', 'ETFs', 'Chips', 'Tech (Mag 7)', 'Crypto', 'Other', 'SPAC']);
  public dateFrom = signal<string>('');
  public dateTo = signal<string>('');
  public isAllTimeActive = computed(() => {
    const from = this.dateFrom();
    const to = this.dateTo();
    if (!from && !to) return true;
    const txs = this.transactions();
    if (txs.length === 0) return true;
    const dates = txs.map(t => t.date ? t.date.slice(0, 10) : '').filter(Boolean).sort();
    if (dates.length === 0) return true;
    return from === dates[0] && to === dates[dates.length - 1];
  });
  public isPastPeriodActive = computed(() => {
    const to = this.dateTo();
    if (!to) return false;
    // Get calendar year of the end filter date
    const toYear = new Date(to).getFullYear();
    const currentYear = new Date().getFullYear();
    return toYear < currentYear;
  });
  public dateFormat = signal<string>('MMMM d, yyyy');
  public yearBasis = signal<'calendar' | 'financial'>('calendar');
  public financialYearStartMonth = signal<number>(4);
  public financialYearStartDay = signal<number>(6);

  public useProperSectors = signal<boolean>(false);
  public splitAdjustedSources = signal<string[]>([]);
  public costBasisMethod = signal<'fifo' | 'avg'>('fifo');
  public disabledSources = signal<string[]>([]);
  public lastRefreshTime = signal<number | null>(null);
  public isSyncing = signal<boolean>(false);
  public theme = signal<'dark' | 'light'>('dark');
  public nextSyncCountdown = signal<string>('3m 00s');

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
    const clean = ticker.replace(/\..*$/, '').toUpperCase().trim();
    const full = ticker.toUpperCase().trim();
    const config = this.tickerConfigs()[full] || this.tickerConfigs()[clean];
    if (this.useProperSectors()) {
      return storedSector || config?.sector || 'Other';
    } else {
      return config?.customSector || this.sectorMap[clean] || 'Other';
    }
  }

  public getTickerName(ticker: string, storedName?: string): string {
    const clean = ticker.replace(/\..*$/, '').toUpperCase().trim();
    const full = ticker.toUpperCase().trim();
    if (!this.useProperSectors()) {
      return this.companyNameMap[clean] || ticker;
    }
    const config = this.tickerConfigs()[full] || this.tickerConfigs()[clean];
    return storedName || config?.name || ticker;
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
  
  // Google Drive Sync properties
  public googleClientId = signal<string>('309949315167-dvuguf67papta8jlu9hjdgljccli6njo.apps.googleusercontent.com');
  public googleFileName = signal<string>('portfolio_tracker_transactions.json');
  public isGoogleConnected = signal<boolean>(false);
  public googleUserEmail = signal<string>('');
  public lastGoogleSyncTime = signal<number | null>(null);
  public isGoogleSyncing = signal<boolean>(false);
  public lastUpdated = signal<number>(0);

  private accessToken: string | null = null;
  private tokenClient: any = null;
  private pendingGoogleDriveAction: 'upload' | 'download' | null = null;
  private failedTickers = new Set<string>();
  private lastFetchTimeMap = new Map<string, number>();
  private lastDailyFetchMap = new Map<string, string>();
  private maxFetchedRangeLevelMap = new Map<string, number>();

  // Names of the two portfolio owners
  public personAName = signal<string>('Person A');
  public personBName = signal<string>('Person B');
  public showNameColumn = signal<boolean>(false);
  public showNameHoldings = signal<boolean>(false);
  public showNameRealized = signal<boolean>(false);
  public showNameTransactions = signal<boolean>(false);

  constructor() {
    this.loadFromStorage();
    const savedTheme = (localStorage.getItem('pt_theme') as 'dark' | 'light') || 'dark';
    this.theme.set(savedTheme);
    this.applyTheme(savedTheme);

    // Default to current calendar year if no dates set
    if (!this.dateFrom()) {
      const yr = new Date().getFullYear();
      this.dateFrom.set(`${yr}-01-01`);
    }
    if (!this.dateTo()) {
      const yr = new Date().getFullYear();
      this.dateTo.set(`${yr}-12-31`);
    }

    effect(() => {
      this.transactions();
      untracked(() => {
        this.failedTickers.clear();
      });
    });

    effect(() => {
      const activePairs = this.getExchangeRatePairs();
      const currentRates = this.exchangeRates();
      
      let modified = false;
      const updated = { ...currentRates };
      
      Object.keys(updated).forEach(key => {
        if (!activePairs.includes(key)) {
          delete updated[key];
          modified = true;
        }
      });
      
      activePairs.forEach(key => {
        if (updated[key] === undefined) {
          if (key === 'EUR/USD') updated[key] = 1.14;
          else if (key === 'USD/EUR') updated[key] = 0.8772;
          else {
            updated[key] = 1.0;
          }
          modified = true;
        }
      });
      
      if (modified) {
        setTimeout(() => {
          this.exchangeRates.set(updated);
          this.saveToStorage();
        }, 0);
      }
    });

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
        },
        {
          name: 'Vested Statement',
          delimiter: ',',
          hasHeader: true,
          mappings: { date: 0, time: 1, ticker: 3, type: 4, quantity: 6, price: 7, totalAmount: 8, currency: -1, fxRate: -1, fees: 9 }
        }
      ]);
      this.saveToStorage();
    } else {
      const current = this.templates();
      if (!current.some(t => t.name === 'Vested Statement')) {
        this.templates.set([
          ...current,
          {
            name: 'Vested Statement',
            delimiter: ',',
            hasHeader: true,
            mappings: { date: 0, time: 1, ticker: 3, type: 4, quantity: 6, price: 7, totalAmount: 8, currency: -1, fxRate: -1, fees: 9 }
          }
        ]);
        this.saveToStorage();
      }
    }

    // Smart auto-refresh prices and countdown loop (runs every second)
    setInterval(() => {
      if (this.isSyncing()) {
        this.nextSyncCountdown.set('Syncing...');
        return;
      }
      const last = this.lastRefreshTime();
      if (!last) {
        this.refreshMarketData(false);
        this.nextSyncCountdown.set('3m 00s');
        return;
      }
      const elapsed = Date.now() - last;
      const intervalMs = 3 * 60 * 1000;
      if (elapsed >= intervalMs) {
        this.refreshMarketData(false);
        this.nextSyncCountdown.set('3m 00s');
      } else {
        const remaining = intervalMs - elapsed;
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        this.nextSyncCountdown.set(`${minutes}m ${seconds.toString().padStart(2, '0')}s`);
      }
    }, 1000);
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
        
        list = this.deduplicateTransactionsList(list);
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
      if (meta) {
        this.tickerConfigs.set(JSON.parse(meta));
        // Migrate old splitRatio/splitDate to splits[] array
        const configs = this.tickerConfigs();
        let migrated = false;
        const updatedCfg = { ...configs };
        Object.entries(updatedCfg).forEach(([key, cfg]) => {
          if (cfg.splitRatio && cfg.splitDate && (!cfg.splits || cfg.splits.length === 0)) {
            updatedCfg[key] = { ...cfg, splits: [{ date: cfg.splitDate, ratio: cfg.splitRatio }] };
            migrated = true;
          }
        });
        if (migrated) {
          this.tickerConfigs.set(updatedCfg);
        }
      }

      const pA = localStorage.getItem('pt_person_a_name');
      if (pA !== null) this.personAName.set(pA);

      const pB = localStorage.getItem('pt_person_b_name');
      if (pB !== null) this.personBName.set(pB);

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

      const cs = localStorage.getItem('pt_custom_sectors');
      if (cs) this.customSectors.set(JSON.parse(cs));

      const vc = localStorage.getItem('pt_visible_currencies');
      if (vc) this.visibleCurrencies.set(JSON.parse(vc));

      // Load persisted fetch maps
      const ldfm = localStorage.getItem('pt_last_daily_fetch_map');
      if (ldfm) {
        try {
          const obj = JSON.parse(ldfm) as Record<string, string>;
          this.lastDailyFetchMap = new Map(Object.entries(obj));
        } catch (e) {
          console.error('Failed to parse lastDailyFetchMap', e);
        }
      }

      const mfrlm = localStorage.getItem('pt_max_fetched_range_level_map');
      if (mfrlm) {
        try {
          const obj = JSON.parse(mfrlm) as Record<string, number>;
          this.maxFetchedRangeLevelMap = new Map(Object.entries(obj).map(([k, v]) => [k, Number(v)]));
        } catch (e) {
          console.error('Failed to parse maxFetchedRangeLevelMap', e);
        }
      }

      const savedHist = localStorage.getItem('pt_historical_prices');
      if (savedHist) {
        this.historicalPrices.set(JSON.parse(savedHist));
      }

      const yb = localStorage.getItem('pt_year_basis');
      if (yb) this.yearBasis.set(yb as 'calendar' | 'financial');

      const fysm = localStorage.getItem('pt_fy_start_month');
      if (fysm) this.financialYearStartMonth.set(parseInt(fysm, 10));

      const fysd = localStorage.getItem('pt_fy_start_day');
      if (fysd) this.financialYearStartDay.set(parseInt(fysd, 10));

      const cid = localStorage.getItem('pt_google_client_id');
      if (cid) this.googleClientId.set(cid);

      const fn = localStorage.getItem('pt_google_file_name');
      if (fn) this.googleFileName.set(fn);

      const gconn = localStorage.getItem('pt_google_connected');
      if (gconn) this.isGoogleConnected.set(gconn === 'true');

      const gemail = localStorage.getItem('pt_google_user_email');
      if (gemail) this.googleUserEmail.set(gemail);

      const gsync = localStorage.getItem('pt_last_google_sync');
      if (gsync) this.lastGoogleSyncTime.set(parseInt(gsync, 10));

      const sas = localStorage.getItem('pt_split_adjusted_sources');
      if (sas) this.splitAdjustedSources.set(JSON.parse(sas));

      const cbm = localStorage.getItem('pt_cost_basis_method');
      if (cbm === 'fifo' || cbm === 'avg') this.costBasisMethod.set(cbm);

      const ds = localStorage.getItem('pt_disabled_sources');
      if (ds) this.disabledSources.set(JSON.parse(ds));

      const lrt = localStorage.getItem('pt_last_refresh_time');
      if (lrt) this.lastRefreshTime.set(parseInt(lrt, 10));

      const lu = localStorage.getItem('pt_last_updated');
      if (lu) this.lastUpdated.set(parseInt(lu, 10));
    } catch (e) {
      console.error('Failed to load portfolio tracker data from localStorage', e);
    }
  }

  public saveToStorage() {
    this.lastUpdated.set(Date.now());
    localStorage.setItem('pt_last_updated', this.lastUpdated().toString());

    localStorage.setItem('pt_transactions', JSON.stringify(this.transactions()));
    localStorage.setItem('pt_templates', JSON.stringify(this.templates()));
    localStorage.setItem('pt_ticker_configs', JSON.stringify(this.tickerConfigs()));
    localStorage.setItem('pt_exchange_rates', JSON.stringify(this.exchangeRates()));
    localStorage.setItem('pt_historical_prices', JSON.stringify(this.historicalPrices()));
    localStorage.setItem('pt_custom_sectors', JSON.stringify(this.customSectors()));
    localStorage.setItem('pt_visible_currencies', JSON.stringify(this.visibleCurrencies()));
    localStorage.setItem('pt_use_proper_sectors', this.useProperSectors().toString());

    localStorage.setItem('pt_person_a_name', this.personAName());
    localStorage.setItem('pt_person_b_name', this.personBName());
    localStorage.setItem('pt_date_format', this.dateFormat());

    // Persist fetch maps
    const ldfmObj: Record<string, string> = {};
    this.lastDailyFetchMap.forEach((value, key) => {
      ldfmObj[key] = value;
    });
    localStorage.setItem('pt_last_daily_fetch_map', JSON.stringify(ldfmObj));

    const mfrlmObj: Record<string, number> = {};
    this.maxFetchedRangeLevelMap.forEach((value, key) => {
      mfrlmObj[key] = value;
    });
    localStorage.setItem('pt_max_fetched_range_level_map', JSON.stringify(mfrlmObj));

    localStorage.setItem('pt_year_basis', this.yearBasis());
    localStorage.setItem('pt_fy_start_month', this.financialYearStartMonth().toString());
    localStorage.setItem('pt_fy_start_day', this.financialYearStartDay().toString());
    localStorage.setItem('pt_show_name_column', this.showNameColumn().toString());
    localStorage.setItem('pt_show_name_holdings', this.showNameHoldings().toString());
    localStorage.setItem('pt_show_name_realized', this.showNameRealized().toString());
    localStorage.setItem('pt_show_name_transactions', this.showNameTransactions().toString());
    localStorage.setItem('pt_db_version', '2.0');

    localStorage.setItem('pt_google_client_id', this.googleClientId());
    localStorage.setItem('pt_google_file_name', this.googleFileName());
    localStorage.setItem('pt_google_connected', this.isGoogleConnected().toString());
    localStorage.setItem('pt_google_user_email', this.googleUserEmail());
    if (this.lastGoogleSyncTime() !== null) {
      localStorage.setItem('pt_last_google_sync', this.lastGoogleSyncTime()!.toString());
    }

    localStorage.setItem('pt_split_adjusted_sources', JSON.stringify(this.splitAdjustedSources()));
    localStorage.setItem('pt_cost_basis_method', this.costBasisMethod());
    localStorage.setItem('pt_disabled_sources', JSON.stringify(this.disabledSources()));
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

  public getDeduplicationSignature(tx: Transaction): string {
    const d = tx.date ? tx.date.slice(0, 19) : '';
    const ticker = (tx.ticker || '').toUpperCase().trim();
    const type = (tx.type || '').toUpperCase().trim();
    const qty = Number(tx.quantity || 0).toFixed(6);
    const price = Number(tx.price || 0).toFixed(4);
    const amount = Number(tx.totalAmount || 0).toFixed(2);
    const currency = (tx.currency || '').toUpperCase().trim();
    return `${d}_${ticker}_${type}_${qty}_${price}_${amount}_${currency}`;
  }

  public deduplicateTransactionsList(txs: Transaction[]): Transaction[] {
    const seen = new Set<string>();
    const unique: Transaction[] = [];
    txs.forEach((tx) => {
      const sig = this.getDeduplicationSignature(tx);
      if (!seen.has(sig)) {
        unique.push(tx);
        seen.add(sig);
      }
    });
    return unique;
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

  public updateTickerConfig(ticker: string, currentPrice: number, sector: string, name: string = '', priceCurrency?: string, logoData?: string, yahooSymbol?: string, customSector?: string, splitRatio?: number, splitDate?: string) {
    const cleanTicker = ticker.replace(/\..*$/, '').toUpperCase().trim();
    const finalSector = sector || 'Other';

    const prev = this.tickerConfigs();
    // Preserve existing priceCurrency if not explicitly provided
    const existingCurrency = prev[ticker.toUpperCase()]?.priceCurrency;
    const finalCurrency = priceCurrency || existingCurrency || this.getTickerCurrency(ticker);
    const existingLogo = prev[ticker.toUpperCase()]?.logoData;
    const finalLogo = logoData || existingLogo;
    const existingYahooSymbol = prev[ticker.toUpperCase()]?.yahooSymbol;
    const finalYahooSymbol = yahooSymbol !== undefined ? yahooSymbol : existingYahooSymbol;
    const existingCustomSector = prev[ticker.toUpperCase()]?.customSector;
    const finalCustomSector = customSector !== undefined ? customSector : existingCustomSector;

    if (finalYahooSymbol !== existingYahooSymbol) {
      const pricesObj = { ...this.historicalPrices() };
      delete pricesObj[ticker.toUpperCase()];
      this.historicalPrices.set(pricesObj);
      localStorage.setItem('pt_historical_prices', JSON.stringify(pricesObj));
      this.failedTickers.delete(ticker.toUpperCase());
    }

    this.tickerConfigs.update((p) => {
      const updated = {
        ...p,
        [ticker.toUpperCase()]: {
          ticker: ticker.toUpperCase(),
          currentPrice: parseFloat(currentPrice as any) || 0,
          priceCurrency: finalCurrency,
          sector: finalSector,
          name: name || p[ticker.toUpperCase()]?.name || ticker,
          logoData: finalLogo,
          yahooSymbol: finalYahooSymbol,
          customSector: finalCustomSector,
          splitRatio: splitRatio !== undefined ? splitRatio : p[ticker.toUpperCase()]?.splitRatio,
          splitDate: splitDate !== undefined ? splitDate : p[ticker.toUpperCase()]?.splitDate
        }
      };
      return updated;
    });
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

  public getExchangeRate(from: string, to: string, date?: string): number {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return 1.0;
    
    const rates = this.exchangeRates();

    const getHistoricalRateVal = (base: string, quote: string, dateVal: string): number | null => {
      const formattedDate = dateVal.slice(0, 10);
      const symbol = `${base}${quote}=X`;
      const history = this.historicalPrices()[symbol];
      if (history) {
        const availableDates = Object.keys(history).sort();
        let matchedDate = '';
        for (let i = availableDates.length - 1; i >= 0; i--) {
          if (availableDates[i] <= formattedDate) {
            matchedDate = availableDates[i];
            break;
          }
        }
        if (matchedDate && history[matchedDate] > 0) {
          return history[matchedDate];
        }
      }
      return null;
    };

    const getRateVal = (base: string, quote: string): number | null => {
      if (date) {
        const histDirect = getHistoricalRateVal(base, quote, date);
        if (histDirect !== null) return histDirect;
        const histInverse = getHistoricalRateVal(quote, base, date);
        if (histInverse !== null && histInverse > 0) return 1.0 / histInverse;
      }

      const keys = [
        `${base}/${quote}`,
        `${base}${quote}`,
        `${base}${quote}=X`
      ];
      for (const key of keys) {
        if (rates[key] !== undefined && rates[key] > 0) {
          return rates[key];
        }
      }
      return null;
    };

    const getCurrencyToUsdRate = (curr: string): number => {
      const direct = getRateVal(curr, 'USD');
      if (direct !== null) return direct;
      
      const inverse = getRateVal('USD', curr);
      if (inverse !== null && inverse > 0) return 1.0 / inverse;

      if (curr === 'EUR') return 1.14;
      if (curr === 'GBP') return 1.28;
      return 1.0;
    };

    if (t === 'USD') {
      return getCurrencyToUsdRate(f);
    }

    if (f === 'USD') {
      return 1.0 / getCurrencyToUsdRate(t);
    }

    return getCurrencyToUsdRate(f) * (1.0 / getCurrencyToUsdRate(t));
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
    
    // Sort transactions chronologically (oldest first). Filter out transactions AFTER 'to' because they happen in the future relative to the selected range.
    // BUT keep transactions BEFORE 'from' because they establish cost basis!
    const txs = [...rawTxs]
      .filter(tx => !tx.date || !to || tx.date.slice(0, 10) <= to)
      .filter(tx => !this.disabledSources().includes(tx.source || ''))
      .sort((a, b) => {
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

    // FIFO lot tracking: per-ticker array of {shares, costPerShare}
    const fifoLots = new Map<string, { shares: number; costPerShare: number }[]>();
    const useFifo = this.costBasisMethod() === 'fifo';

    let totalFees = 0;

    for (const tx of txs) {
      const ticker = tx.ticker.toUpperCase().trim();
      const isStock = ticker.length > 0;
      if (!isStock) continue;

      const cfg = meta[ticker];
      let sharesAllocated = owner === 'A' ? tx.personAShares : tx.personBShares;
      const costAllocated = owner === 'A' ? tx.personACostBasis : tx.personBCostBasis;
      let totalShares = tx.quantity || 0;

      // Apply stock splits — skip for sources marked as split-adjusted
      const isSplitAdjustedSource = this.splitAdjustedSources().includes(tx.source || '');
      if (!isSplitAdjustedSource && cfg?.splits?.length && tx.date) {
        for (const sp of cfg.splits) {
          if (tx.date.slice(0, 10) < sp.date) {
            sharesAllocated *= sp.ratio;
            totalShares *= sp.ratio;
          }
        }
      } else if (!isSplitAdjustedSource && cfg && cfg.splitRatio && cfg.splitDate && tx.date && tx.date.slice(0, 10) < cfg.splitDate) {
        sharesAllocated *= cfg.splitRatio;
        totalShares *= cfg.splitRatio;
      }
      
      // FX Rate translates Tx currency to Base (USD): Base = Tx * rateToUsd
      const rateToUsd = tx.currency.toUpperCase() === 'USD'
        ? 1.0
        : (tx.fxRate && tx.fxRate !== 1.0 ? tx.fxRate : this.getExchangeRate(tx.currency, 'USD', tx.date));

      const baseCost = costAllocated * rateToUsd;

      const ownerFraction = totalShares > 0 ? (sharesAllocated / totalShares) : 0;
      
      const txDateStr = tx.date ? tx.date.slice(0, 10) : '';
      const inDateRange = !from || txDateStr >= from;

      if (inDateRange) {
        totalFees += (tx.fees || 0) * rateToUsd * ownerFraction;
      }

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
      if (!fifoLots.has(ticker)) {
        fifoLots.set(ticker, []);
      }
      const pos = positionsMap.get(ticker)!;
      const lots = fifoLots.get(ticker)!;
      pos.rateToUsd = rateToUsd;

      if (tx.type.toUpperCase() === 'BUY') {
        if (sharesAllocated > 0) {
          pos.shares += sharesAllocated;
          pos.totalCost += baseCost;
          if (useFifo) {
            lots.push({ shares: sharesAllocated, costPerShare: baseCost / sharesAllocated });
          }
        }
      } else if (tx.type.toUpperCase() === 'SELL') {
        if (sharesAllocated > 0) {
          let costOfSharesSold = 0;

          if (useFifo) {
            // FIFO: consume oldest lots first
            let remaining = sharesAllocated;
            while (remaining > 0 && lots.length > 0) {
              const lot = lots[0];
              const take = Math.min(remaining, lot.shares);
              costOfSharesSold += take * lot.costPerShare;
              lot.shares -= take;
              remaining -= take;
              if (lot.shares <= 0.000001) {
                lots.shift();
              }
            }
          } else {
            // Average cost method
            const avgCostBeforeSell = pos.shares > 0 ? (pos.totalCost / pos.shares) : 0;
            costOfSharesSold = sharesAllocated * avgCostBeforeSell;
          }
          
          pos.shares = Math.max(0, pos.shares - sharesAllocated);
          pos.totalCost = Math.max(0, pos.totalCost - costOfSharesSold);

          const sellRevenueBase = baseCost;
          const txRealizedProfit = sellRevenueBase - costOfSharesSold;

          if (inDateRange) {
            pos.realizedProfit += txRealizedProfit;
            pos.realizedCost += costOfSharesSold;
          }
        }
      } else if (tx.type.toUpperCase() === 'DIVIDEND') {
        if (inDateRange) {
          pos.dividends += baseCost;
        }
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
      const liveRateToUsd = this.getExchangeRate(storedPriceCurrency, 'USD', to);

      let currentPriceNative = priceData.currentPrice || 0;
      if (to && this.isPastPeriodActive()) {
        const history = this.historicalPrices()[ticker];
        if (history) {
          const availableDates = Object.keys(history).sort();
          let matchedDate = '';
          for (let i = availableDates.length - 1; i >= 0; i--) {
            if (availableDates[i] <= to) {
              matchedDate = availableDates[i];
              break;
            }
          }
          if (matchedDate) {
            currentPriceNative = history[matchedDate];
          }
        }
      }

      const currentPriceUsd = currentPriceNative > 0
        ? currentPriceNative * liveRateToUsd
        : (pos.shares > 0 ? averageCost : 0);
      
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
        realizedCost: parseFloat(pos.realizedCost.toFixed(2)),
      });

      totalValue += currentValue;
      totalCostBasis += pos.shares * averageCost;
      totalUnrealized += unrealizedProfit;
      totalRealized += pos.realizedProfit;
      totalDividends += pos.dividends;
    });

    const activePositions = positions.filter(p => p.totalShares > 0.0001);
    activePositions.sort((a, b) => b.currentValue - a.currentValue);

    const totalReturn = !this.isPastPeriodActive()
      ? totalUnrealized + totalRealized + totalDividends
      : totalRealized + totalDividends;

    return {
      ownerName: owner === 'A' ? this.personAName() : this.personBName(),
      positions: activePositions,
      totalValue: parseFloat(totalValue.toFixed(2)),
      totalCostBasis: parseFloat(totalCostBasis.toFixed(2)),
      totalUnrealized: parseFloat(totalUnrealized.toFixed(2)),
      totalRealized: parseFloat(totalRealized.toFixed(2)),
      totalDividends: parseFloat(totalDividends.toFixed(2)),
      totalReturn: parseFloat(totalReturn.toFixed(2)),
      totalFees: parseFloat(totalFees.toFixed(2)),
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

  public failedLogos = signal<Set<string>>((() => {
    try {
      const saved = localStorage.getItem('pt_failed_logos');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  })());

  public onLogoError(ticker: string) {
    if (!ticker) return;
    const clean = ticker.split('.')[0].toUpperCase().trim();
    this.failedLogos.update((prev) => {
      const next = new Set(prev);
      next.add(clean);
      try {
        localStorage.setItem('pt_failed_logos', JSON.stringify(Array.from(next)));
      } catch {}
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
  public async loadMarketPricesApi(force: boolean = false, silent: boolean = false) {
    if (force) {
      this.failedTickers.clear();
      this.lastFetchTimeMap.clear();
      this.lastDailyFetchMap.clear();
      this.maxFetchedRangeLevelMap.clear();
    }

    const tickers = this.allTickers();
    if (tickers.length === 0) {
      if (!silent) this.showToast('No tickers in transactions to fetch prices for.', 'info');
      return;
    }



    if (!silent) this.showToast('Fetching real-time market rates with autocomplete discovery...', 'info');

    try {
      let updatedCount = 0;
      const meta = this.tickerConfigs();

      // Set up symbol mapping for bulk fetch
      const symbolMap = new Map<string, string>(); // resolvedSymbol -> originalTicker
      const symbolsToFetch: string[] = [];

      tickers.forEach(ticker => {
        const cleanTicker = ticker.toUpperCase().trim();
        const config = meta[cleanTicker];
        let resolvedSymbol = cleanTicker;
        if (config && config.yahooSymbol) {
          const symbolOverride = config.yahooSymbol.toUpperCase().trim();
          if (symbolOverride.startsWith('.')) {
            resolvedSymbol = cleanTicker + symbolOverride;
          } else if (!symbolOverride.includes('.') && symbolOverride.length <= 4 && symbolOverride !== cleanTicker) {
            resolvedSymbol = cleanTicker + '.' + symbolOverride;
          } else {
            resolvedSymbol = symbolOverride;
          }
        }
        symbolMap.set(resolvedSymbol, cleanTicker);
        symbolsToFetch.push(resolvedSymbol);
      });

      // Fetch quote data in a single request
      const symbolsList = symbolsToFetch.join(',');
      const targetUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolsList)}`;
      
      const bulkResponse = await this.fetchWithProxy(targetUrl, true);
      const bulkUpdatedSet = new Set<string>();

      if (bulkResponse.ok) {
        const json = await bulkResponse.json();
        const results = json?.quoteResponse?.result || [];
        
        results.forEach((q: any) => {
          const resolvedSymbol = (q.symbol || '').toUpperCase().trim();
          const ticker = symbolMap.get(resolvedSymbol);
          if (ticker) {
            let price = q.regularMarketPrice || q.regularMarketPreviousClose || 0;
            let currency = (q.currency || 'USD').toUpperCase();
            
            if (price > 0) {
              if (currency === 'GBP' || q.currency === 'GBp') {
                if (q.currency === 'GBp') price = price / 100;
                currency = 'GBP';
              }
              
              const current = meta[ticker] || {};
              const finalSector = current.sector || 'Other';
              const finalName = q.longName || q.shortName || current.name || ticker;
              const finalLogo = current.logoData;
              
              this.updateTickerConfig(ticker, price, finalSector, finalName, currency, finalLogo);
              bulkUpdatedSet.add(ticker);
              updatedCount++;
            }
          }
        });
      }

      // Autocomplete discovery helper for remaining tickers
      const fetchWithSelfDiscovery = async (ticker: string): Promise<{ ticker: string, price: number, priceCurrency: string, sector?: string, name?: string, logoData?: string } | null> => {
        try {
          const cleanTicker = ticker.toUpperCase().trim();
          let resolvedSymbol = cleanTicker;
          let sector = 'Other';
          let name = cleanTicker;
          
          const config = meta[cleanTicker];
          if (config && config.yahooSymbol) {
            const symbolOverride = config.yahooSymbol.toUpperCase().trim();
            if (symbolOverride.startsWith('.')) {
              resolvedSymbol = cleanTicker + symbolOverride;
            } else if (!symbolOverride.includes('.') && symbolOverride.length <= 4 && symbolOverride !== cleanTicker) {
              resolvedSymbol = cleanTicker + '.' + symbolOverride;
            } else {
              resolvedSymbol = symbolOverride;
            }
            name = config.name || cleanTicker;
            sector = config.sector || 'Other';
          } else {
            const searchTarget = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanTicker)}`;
            const searchResponse = await this.fetchWithProxy(searchTarget, true);
            if (searchResponse.ok) {
              const searchData = await searchResponse.json();
              const quotes = searchData?.quotes || [];
              
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
          }

          const cleanResolved = encodeURIComponent(resolvedSymbol);
          const chartTarget = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanResolved}?includePrePost=true&events=split`;
          
          const chartResponse = await this.fetchWithProxy(chartTarget, true);
          if (!chartResponse.ok) return null;
          
          const data = await chartResponse.json();
          const result = data?.chart?.result?.[0];
          const chartMeta = result?.meta;
          if (chartMeta) {
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
              if (currency === 'GBP' || chartMeta.currency === 'GBp') {
                if (chartMeta.currency === 'GBp') price = price / 100;
                currency = 'GBP';
              }

              // Extract splits from Yahoo chart response
              const events = result?.events;
              if (events?.splits) {
                const splitsArr: { date: string; ratio: number }[] = [];
                Object.values(events.splits).forEach((s: any) => {
                  if (s.numerator && s.denominator) {
                    const d = new Date(s.date * 1000);
                    const dateStr = d.toISOString().slice(0, 10);
                    splitsArr.push({ date: dateStr, ratio: s.numerator / s.denominator });
                  }
                });
                if (splitsArr.length > 0) {
                  splitsArr.sort((a, b) => a.date.localeCompare(b.date));
                  const existingCfg = this.tickerConfigs()[cleanTicker];
                  if (!existingCfg?.splits || JSON.stringify(existingCfg.splits) !== JSON.stringify(splitsArr)) {
                    this.tickerConfigs.update(p => ({
                      ...p,
                      [cleanTicker]: { ...(p[cleanTicker] || {}), splits: splitsArr }
                    }));
                  }
                }
              }

              const logoData = meta[cleanTicker]?.logoData;
              return { ticker: cleanTicker, price, priceCurrency: currency, sector, name, logoData };
            }
          }
        } catch (e) {
          console.warn(`Failed to self-discover price/info for ${ticker}:`, e);
        }
        return null;
      };

      const remainingTickers = tickers.filter(t => !bulkUpdatedSet.has(t));
      if (remainingTickers.length > 0) {
        const promises = remainingTickers.map(ticker => fetchWithSelfDiscovery(ticker));
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
      }


      if (updatedCount === 0) {
        throw new Error('All tickers failed to fetch');
      }

      // Save successful refresh timestamp
      localStorage.setItem('pt_last_refresh_time', Date.now().toString());
      if (!silent) this.showToast(`Successfully fetched real-time prices for ${updatedCount} tickers!`, 'success');

    } catch (err) {
      console.warn('Real-time fetch failed:', err);
      if (!silent) {
        this.showToast('Real-time API fetch failed.', 'error');
        this.showAlert(
          'Real-time Fetch Failed',
          'We were unable to contact the Yahoo Finance API (rate-limiting or offline). Keeping last known prices.'
        );
      }
    }
  }

  public getExchangeRatePairs(): string[] {
    const currencies = Array.from(new Set(['USD', 'EUR', ...this.visibleCurrencies()]));
    const pairs: string[] = [];
    currencies.forEach(c => {
      if (c !== 'USD') {
        pairs.push(`${c}/USD`);
        pairs.push(`USD/${c}`);
      }
    });
    if (currencies.includes('GBP')) {
      pairs.push('EUR/GBP');
      pairs.push('GBP/EUR');
    }
    return pairs;
  }

  public getYearRange(offset: number): { from: string; to: string } {
    const now = new Date();
    if (this.yearBasis() === 'calendar') {
      const targetYear = now.getFullYear() + offset;
      return {
        from: `${targetYear}-01-01`,
        to: `${targetYear}-12-31`
      };
    } else {
      const m = this.financialYearStartMonth();
      const d = this.financialYearStartDay();
      
      const startOfThisYear = new Date(now.getFullYear(), m - 1, d);
      let currentFYStartYear = now.getFullYear();
      if (now < startOfThisYear) {
        currentFYStartYear -= 1;
      }
      
      const targetFYStartYear = currentFYStartYear + offset;
      const start = new Date(targetFYStartYear, m - 1, d);
      const end = new Date(targetFYStartYear + 1, m - 1, d - 1);
      
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        from: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
        to: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`
      };
    }
  }

  public async loadExchangeRatesApi(force: boolean = false, silent: boolean = false) {
    const pairs = this.getExchangeRatePairs();


    if (!silent) this.showToast('Fetching current exchange rates...', 'info');

    try {
      const updatedRates: Record<string, number> = {};
      let updatedCount = 0;

      const fetchRate = async (pair: string): Promise<{ pair: string, price: number } | null> => {
        try {
          const parts = pair.split('/');
          const ticker = `${parts[0]}${parts[1]}=X`;
          const chartTarget = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
          
          const response = await this.fetchWithProxy(chartTarget, true);
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
      
      pairs.forEach((pair, idx) => {
        const res = results[idx];
        if (res) {
          updatedRates[res.pair] = parseFloat(res.price.toFixed(6));
          updatedCount++;
        } else {
          const prev = this.exchangeRates()[pair];
          if (prev !== undefined) {
            updatedRates[pair] = prev;
          }
        }
      });

      if (updatedCount > 0) {
        this.exchangeRates.set(updatedRates);
        this.saveToStorage();
        localStorage.setItem('pt_last_rates_refresh_time', Date.now().toString());
        if (!silent) this.showToast(`Successfully refreshed ${updatedCount} exchange rates!`, 'success');
      } else {
        throw new Error('All rates failed to fetch');
      }
    } catch (err) {
      console.warn('Exchange rates fetch failed:', err);
      if (!silent) this.showToast('Failed to fetch exchange rates.', 'error');
    }
  }

  // Google Drive REST API & SDK Sync Integration
  public initializeGoogleDriveSDK() {
    if (!this.googleClientId().trim()) {
      return;
    }
    try {
      if (typeof google === 'undefined') {
        return;
      }
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.googleClientId().trim(),
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: async (resp: any) => {
          if (resp.error) {
            this.showToast('Authentication failed: ' + resp.error, 'error');
            return;
          }
          if (resp.access_token) {
            this.accessToken = resp.access_token;
            this.isGoogleConnected.set(true);
            localStorage.setItem('pt_google_connected', 'true');
            this.showToast('Connected to Google Drive!', 'success');
            if (this.pendingGoogleDriveAction === 'upload') {
              this.uploadToGoogleDrive();
            } else if (this.pendingGoogleDriveAction === 'download') {
              this.downloadFromGoogleDrive();
            }
            this.pendingGoogleDriveAction = null;
          }
        }
      });
    } catch (err) {
      console.error('Failed to init Google Drive SDK', err);
    }
  }

  public connectGoogleDrive() {
    if (!this.googleClientId().trim()) {
      this.showToast('Please enter your Google Client ID first.', 'error');
      return;
    }
    if (!this.tokenClient) {
      this.initializeGoogleDriveSDK();
    }
    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      this.showToast('Google GIS script is loading. Try again in a moment.', 'info');
    }
  }

  public disconnectGoogleDrive() {
    this.accessToken = null;
    this.isGoogleConnected.set(false);
    this.googleUserEmail.set('');
    this.lastGoogleSyncTime.set(null);
    localStorage.removeItem('pt_google_connected');
    localStorage.removeItem('pt_google_user_email');
    localStorage.removeItem('pt_last_google_sync');
    this.showToast('Disconnected from Google Drive.', 'info');
  }

  private async findDriveFile(fileName: string): Promise<string | null> {
    try {
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(fileName)}' and trashed=false&fields=files(id,name)`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`
          }
        }
      );
      if (!resp.ok) {
        throw new Error(`Search failed: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
      return null;
    } catch (e) {
      console.error('Error finding file on Google Drive', e);
      return null;
    }
  }

  private async createDriveFile(fileName: string, content: any): Promise<string | null> {
    try {
      const metadata = {
        name: fileName,
        mimeType: 'application/json'
      };
      
      const boundary = 'foo_bar_boundary';
      const multipartBody = 
        `\r\n--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${JSON.stringify(content)}\r\n` +
        `--${boundary}--`;

      const resp = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: multipartBody
        }
      );
      if (!resp.ok) {
        throw new Error(`Creation failed: ${resp.statusText}`);
      }
      const data = await resp.json();
      return data.id;
    } catch (e) {
      console.error('Error creating file on Google Drive', e);
      return null;
    }
  }

  private async updateDriveFile(fileId: string, content: any): Promise<boolean> {
    try {
      const resp = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(content)
        }
      );
      return resp.ok;
    } catch (e) {
      console.error('Error updating file on Google Drive', e);
      return false;
    }
  }

  private async downloadDriveFile(fileId: string): Promise<any | null> {
    try {
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`
          }
        }
      );
      if (!resp.ok) {
        throw new Error(`Download failed: ${resp.statusText}`);
      }
      return await resp.json();
    } catch (e) {
      console.error('Error downloading file from Google Drive', e);
      return null;
    }
  }

  private applyRemoteData(remoteData: any) {
    if (remoteData.transactions) this.transactions.set(remoteData.transactions);
    if (remoteData.templates) this.templates.set(remoteData.templates);
    if (remoteData.tickerConfigs) this.tickerConfigs.set(remoteData.tickerConfigs);
    if (remoteData.customSectors) this.customSectors.set(remoteData.customSectors);
    if (remoteData.personAName !== undefined) this.personAName.set(remoteData.personAName);
    if (remoteData.personBName !== undefined) this.personBName.set(remoteData.personBName);
    if (remoteData.dateFormat) this.dateFormat.set(remoteData.dateFormat);
    if (remoteData.showNameColumn !== undefined) this.showNameColumn.set(remoteData.showNameColumn);
    if (remoteData.showNameHoldings !== undefined) this.showNameHoldings.set(remoteData.showNameHoldings);
    if (remoteData.showNameRealized !== undefined) this.showNameRealized.set(remoteData.showNameRealized);
    if (remoteData.showNameTransactions !== undefined) this.showNameTransactions.set(remoteData.showNameTransactions);
    if (remoteData.exchangeRates) this.exchangeRates.set(remoteData.exchangeRates);
    if (remoteData.useProperSectors !== undefined) this.useProperSectors.set(remoteData.useProperSectors);
    if (remoteData.historicalPrices) {
      this.historicalPrices.set(remoteData.historicalPrices);
      localStorage.setItem('pt_historical_prices', JSON.stringify(remoteData.historicalPrices));
    }
    if (remoteData.lastUpdated) this.lastUpdated.set(remoteData.lastUpdated);
  }

  private buildLocalData() {
    return {
      transactions: this.transactions(),
      templates: this.templates(),
      tickerConfigs: this.tickerConfigs(),
      customSectors: this.customSectors(),
      personAName: this.personAName(),
      personBName: this.personBName(),
      dateFormat: this.dateFormat(),
      showNameColumn: this.showNameColumn(),
      showNameHoldings: this.showNameHoldings(),
      showNameRealized: this.showNameRealized(),
      showNameTransactions: this.showNameTransactions(),
      exchangeRates: this.exchangeRates(),
      useProperSectors: this.useProperSectors(),
      historicalPrices: this.historicalPrices(),
      lastUpdated: Date.now()
    };
  }

  public async uploadToGoogleDrive() {
    if (!this.accessToken) {
      this.pendingGoogleDriveAction = 'upload';
      this.connectGoogleDrive();
      return;
    }
    const localCount = this.transactions().length;
    const ok = await this.showConfirm(
      'Upload to Google Drive',
      `This will OVERWRITE your Google Drive backup with your current local data (${localCount} transactions). Are you sure?`
    );
    if (!ok) return;

    this.isGoogleSyncing.set(true);
    try {
      const fileName = this.googleFileName().trim() || 'portfolio_tracker_transactions.json';
      const localData = this.buildLocalData();
      const fileId = await this.findDriveFile(fileName);
      let success = false;
      if (!fileId) {
        const newId = await this.createDriveFile(fileName, localData);
        success = !!newId;
      } else {
        success = await this.updateDriveFile(fileId, localData);
      }
      if (success) {
        this.lastUpdated.set(localData.lastUpdated);
        this.lastGoogleSyncTime.set(Date.now());
        localStorage.setItem('pt_last_google_sync', this.lastGoogleSyncTime()!.toString());
        this.showToast('Uploaded to Google Drive successfully!', 'success');
      } else {
        this.showToast('Upload failed.', 'error');
      }
    } catch (e) {
      this.showToast('Upload failed: ' + e, 'error');
    } finally {
      this.isGoogleSyncing.set(false);
    }
  }

  public async downloadFromGoogleDrive() {
    if (!this.accessToken) {
      this.pendingGoogleDriveAction = 'download';
      this.connectGoogleDrive();
      return;
    }
    const ok = await this.showConfirm(
      'Download from Google Drive',
      `This will OVERWRITE your current local data with the Google Drive backup. Your local changes will be lost. Are you sure?`
    );
    if (!ok) return;

    this.isGoogleSyncing.set(true);
    try {
      const fileName = this.googleFileName().trim() || 'portfolio_tracker_transactions.json';
      const fileId = await this.findDriveFile(fileName);
      if (!fileId) {
        this.showToast('No portfolio file found on Google Drive.', 'error');
        return;
      }
      const remoteData = await this.downloadDriveFile(fileId);
      if (!remoteData) {
        this.showToast('Failed to download from Google Drive.', 'error');
        return;
      }
      this.applyRemoteData(remoteData);
      this.saveToStorage();
      this.lastGoogleSyncTime.set(Date.now());
      localStorage.setItem('pt_last_google_sync', this.lastGoogleSyncTime()!.toString());
      this.showToast(`Downloaded from Google Drive (${this.transactions().length} transactions).`, 'success');
    } catch (e) {
      this.showToast('Download failed: ' + e, 'error');
    } finally {
      this.isGoogleSyncing.set(false);
    }
  }

  // Keep for backward compatibility
  public async syncWithGoogleDrive() {
    await this.uploadToGoogleDrive();
  }

  public async fetchHistoricalPricesForTickers(tickers: string[], range: string = '1mo') {
    const pricesObj = { ...this.historicalPrices() };
    let updated = false;

    // Filter to tickers with transactions and resolve symbols
    const activeTickers = tickers.map(t => t.toUpperCase().trim()).filter(Boolean);

    // Calculate first transaction date for each ticker
    const firstTxDateMap = new Map<string, string>();
    this.transactions().forEach(t => {
      const ticker = (t.ticker || '').toUpperCase().trim();
      const txDateStr = (t.date || '').slice(0, 10);
      if (ticker && txDateStr) {
        const existing = firstTxDateMap.get(ticker);
        if (!existing || txDateStr < existing) {
          firstTxDateMap.set(ticker, txDateStr);
        }
      }
    });

    // Determine oldest date needed for the requested range
    const limitDate = new Date();
    let daysNeeded = 30;
    if (range === '3mo') daysNeeded = 90;
    else if (range === '6mo') daysNeeded = 180;
    else if (range === '1y') daysNeeded = 365;
    else if (range === '2y') daysNeeded = 730;
    else if (range === '5y') daysNeeded = 1825;
    else if (range === 'max') daysNeeded = 10000;
    limitDate.setDate(limitDate.getDate() - daysNeeded);
    const limitDateStr = limitDate.toISOString().slice(0, 10);

    const todayStr = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const cooldownMs = 15 * 60 * 1000; // 15 minutes cooldown

    const rangeLevels: Record<string, number> = {
      '1mo': 1,
      '3mo': 2,
      '6mo': 3,
      '1y': 4,
      '2y': 5,
      '5y': 6,
      'max': 7
    };
    const requestedLevel = rangeLevels[range] || 1;

    for (const ticker of activeTickers) {
      if (this.failedTickers.has(ticker)) {
        continue;
      }

      // 1. Check if we already fetched this range (or a larger one) today
      const maxFetchedLevel = this.maxFetchedRangeLevelMap.get(ticker) || 0;
      if (maxFetchedLevel >= requestedLevel) {
        continue;
      }

      // 2. Check range-specific cooldown
      const cooldownKey = `${ticker}_${range}`;
      const lastFetch = this.lastFetchTimeMap.get(cooldownKey) || 0;
      if (now - lastFetch < cooldownMs) {
        continue;
      }

      // 3. Check if cache already covers the requested range and today's latest prices
      const tickerCache = pricesObj[ticker];
      if (tickerCache) {
        const cacheDates = Object.keys(tickerCache).sort();
        if (cacheDates.length > 0) {
          const firstTxDate = firstTxDateMap.get(ticker) || limitDateStr;
          const targetStartDateStr = firstTxDate > limitDateStr ? firstTxDate : limitDateStr;

          const cacheMinTime = new Date(cacheDates[0]).getTime();
          const targetMinTime = new Date(targetStartDateStr).getTime();
          const daysDiff = (cacheMinTime - targetMinTime) / (1000 * 60 * 60 * 24);

          const hasOlderData = daysDiff <= 3; // Allow up to 3 days gap for weekends/holidays
          const fetchedToday = this.lastDailyFetchMap.get(ticker) === todayStr;
          const hasTodayData = cacheDates[cacheDates.length - 1] >= todayStr || fetchedToday;

          if (hasOlderData && hasTodayData) {
            this.maxFetchedRangeLevelMap.set(ticker, Math.max(maxFetchedLevel, requestedLevel));
            continue; // Skip fetch! Cache is already complete!
          }
        }
      }

      // Add a 150ms delay between requests to prevent rate limiting (429)
      await new Promise(resolve => setTimeout(resolve, 150));

      this.lastFetchTimeMap.set(cooldownKey, now);
      this.maxFetchedRangeLevelMap.set(ticker, Math.max(maxFetchedLevel, requestedLevel));

      try {
        const meta = this.tickerConfigs();
        const config = meta[ticker];
        let resolvedSymbol = (config && config.yahooSymbol) ? config.yahooSymbol : ticker;

        let targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(resolvedSymbol)}?range=${range}&interval=1d&events=split`;
        let resp = await this.fetchWithProxy(targetUrl, true);

        // If direct fetch fails, and it's not rate-limited, and no custom symbol override was set, try search discovery
        if (!resp.ok && resp.status !== 429 && !(config && config.yahooSymbol)) {
          const searchTarget = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}`;
          const searchResponse = await this.fetchWithProxy(searchTarget, true);
          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const quotes = searchData?.quotes || [];
            const quote = quotes.find((q: any) => q.isEquity || q.quoteType === 'EQUITY' || q.quoteType === 'ETF');
            if (quote) {
              resolvedSymbol = quote.symbol.toUpperCase();
              targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(resolvedSymbol)}?range=${range}&interval=1d&events=split`;
              resp = await this.fetchWithProxy(targetUrl, true);
            }
          } else {
            this.failedTickers.add(ticker);
            continue;
          }
        }

        if (resp.ok) {
          const json = await resp.json();
          const result = json.chart?.result?.[0];
          if (result) {
            const timestamps = result.timestamp || [];
            const closes = result.indicators?.quote?.[0]?.close || [];
            const tickerPrices: Record<string, number> = {};
            
            timestamps.forEach((ts: number, idx: number) => {
              const closeVal = closes[idx];
              if (closeVal !== null && !isNaN(closeVal) && closeVal > 0) {
                const date = new Date(ts * 1000);
                const dateStr = date.toISOString().slice(0, 10);
                tickerPrices[dateStr] = closeVal;
              }
            });

            pricesObj[ticker] = { ...pricesObj[ticker], ...tickerPrices };
            updated = true;
            this.lastDailyFetchMap.set(ticker, todayStr);

            // Save immediately to prevent loss of progress
            this.historicalPrices.set({ ...pricesObj });
            localStorage.setItem('pt_historical_prices', JSON.stringify(pricesObj));
          } else {
            // No result, treat as failed
            this.failedTickers.add(ticker);
            if (!pricesObj[ticker]) {
              pricesObj[ticker] = {};
              this.historicalPrices.set({ ...pricesObj });
              localStorage.setItem('pt_historical_prices', JSON.stringify(pricesObj));
            }
          }
        } else {
          // Response not OK (e.g. 404, 429), treat as failed
          this.failedTickers.add(ticker);
          if (!pricesObj[ticker]) {
            pricesObj[ticker] = {};
            this.historicalPrices.set({ ...pricesObj });
            localStorage.setItem('pt_historical_prices', JSON.stringify(pricesObj));
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch history for ${ticker}:`, e);
        this.failedTickers.add(ticker);
        if (!pricesObj[ticker]) {
          pricesObj[ticker] = {};
          this.historicalPrices.set({ ...pricesObj });
          localStorage.setItem('pt_historical_prices', JSON.stringify(pricesObj));
        }
      }
    }
  }

  public getCurrencySymbol(curr: string): string {
    const symbols: any = {
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'CHF': 'Fr.',
      'CAD': 'C$',
      'AUD': 'A$',
      'JPY': '¥',
      'INR': '₹'
    };
    return symbols[curr] || (curr + ' ');
  }

  public getCurrencyBtnLabel(curr: string): string {
    const symbols: any = {
      'USD': '$ USD',
      'EUR': '€ EUR',
      'GBP': '£ GBP',
      'CHF': 'Fr. CHF',
      'CAD': 'C$ CAD',
      'AUD': 'A$ AUD',
      'JPY': '¥ JPY',
      'INR': '₹ INR'
    };
    return symbols[curr] || curr;
  }

  private async fetchWithProxy(targetUrl: string, cacheNoStore = false): Promise<Response> {
    const options = cacheNoStore ? { cache: 'no-store' as RequestCache } : {};
    
    const shouldFallback = (status: number) => {
      return status >= 500 || status === 0;
    };

    // 1. Try corsproxy.io
    try {
      const url = `https://corsproxy.io/?${targetUrl}`;
      const resp = await fetch(url, options);
      if (resp.ok || !shouldFallback(resp.status)) return resp;
      console.warn(`corsproxy.io failed (status ${resp.status}) for ${targetUrl}. Trying fallback...`);
    } catch (e) {
      console.warn(`corsproxy.io network error for ${targetUrl}. Trying fallback...`, e);
    }

    // 2. Try api.allorigins.win
    try {
      const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const resp = await fetch(url, options);
      if (resp.ok || !shouldFallback(resp.status)) return resp;
      console.warn(`allorigins failed (status ${resp.status}) for ${targetUrl}. Trying direct...`);
    } catch (e) {
      console.warn(`allorigins network error for ${targetUrl}. Trying direct...`, e);
    }

    // 3. Try direct fetch as last resort
    return fetch(targetUrl, options);
  }

  public async refreshMarketData(force: boolean = false) {
    if (this.isSyncing()) return;
    this.isSyncing.set(true);
    try {
      if (force) {
        this.showToast('Forcing refresh of all market prices and FX rates...', 'info');
      }
      await this.loadMarketPricesApi(force);
      await this.loadExchangeRatesApi(force);
      const now = Date.now();
      localStorage.setItem('pt_last_refresh_time', now.toString());
      this.lastRefreshTime.set(now);
      if (force) {
        this.showToast('All prices and exchange rates up to date!', 'success');
      }
    } catch (e) {
      if (force) {
        this.showToast('Refresh failed.', 'error');
      }
      console.warn('Market sync failed:', e);
    } finally {
      this.isSyncing.set(false);
    }
  }

  public toggleTheme() {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    localStorage.setItem('pt_theme', next);
    this.applyTheme(next);
  }

  public applyTheme(theme: 'dark' | 'light') {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-theme');
      document.body.classList.add('light-theme');
    } else {
      root.classList.remove('light-theme');
      document.body.classList.remove('light-theme');
    }
  }

  public getSyncedTimeAgoText(): string {
    const last = this.lastRefreshTime();
    if (!last) return 'Never';
    const seconds = Math.floor((Date.now() - last) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
}
