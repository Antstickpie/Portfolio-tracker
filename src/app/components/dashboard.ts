import { Component, inject, signal, computed, effect, ElementRef, ViewChild, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioService } from '../services/portfolio.service';
import { PortfolioPosition } from '../models/portfolio-position.model';
import { PersonPortfolioSummary } from '../models/portfolio-summary.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements AfterViewInit {
  public service = inject(PortfolioService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('assetCanvas') assetCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sectorCanvas') sectorCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('tableCard') tableCard!: ElementRef<HTMLElement>;
  @ViewChild('realizedTableCard') realizedTableCard!: ElementRef<HTMLElement>;

  // Combined, ownerA, or ownerB
  public activeView = signal<'combined' | 'ownerA' | 'ownerB'>('combined');
  public displayCurrency = signal<'USD' | 'EUR' | 'native'>('native');

  // Hovered slice states (using Signals so calculated values updates are reactive)
  public hoveredAssetIndex = signal<number>(-1);
  public hoveredSectorIndex = signal<number>(-1);

  // Filter and sort holdings state
  public filterTicker = signal<string>('');
  public filterRealizedTicker = signal<string>('');
  public sortBy = signal<string>('currentValue');
  public sortDirection = signal<'asc' | 'desc'>('desc');
  public sortByRealized = signal<string>('realizedGain');
  public sortDirectionRealized = signal<'asc' | 'desc'>('desc');
  public unrealizedSortMode = signal<'value' | 'pct'>('value');
  public realizedSortMode = signal<'value' | 'pct'>('value');
  public totalReturnSortMode = signal<'value' | 'pct'>('value');
  public realizedLedgerSortMode = signal<'value' | 'pct'>('value');
  public allocationBasis = signal<'value' | 'cost'>('value');
  public currentYear = new Date().getFullYear();
  public isCollapsed = signal<boolean>(false);
  public isRealizedCollapsed = signal<boolean>(false);
  public isRefreshing = signal<boolean>(false);
  public lastRefreshTime = signal<number | null>(null);

  // Computed signal to calculate detailed realized gain events (chronologically correct avg cost, filtered by date)
  public realizedGains = computed(() => {
    const rawTxs = this.service.transactions();
    const from = this.service.dateFrom();
    const to = this.service.dateTo();
    const view = this.activeView();
    
    // Sort all transactions chronologically (oldest first) to compute running avg costs correctly
    const txs = [...rawTxs].sort((a, b) => {
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (diff !== 0) return diff;
      const typeOrder = { 'BUY': 1, 'SELL': 2, 'DIVIDEND': 3 } as any;
      const orderA = typeOrder[a.type.toUpperCase()] || 9;
      const orderB = typeOrder[b.type.toUpperCase()] || 9;
      return orderA - orderB;
    });

    const runningShares = {} as Record<string, number>;
    const runningCost = {} as Record<string, number>; // in USD

    const events: Array<{
      id: string;
      date: string;
      ticker: string;
      name: string;
      shares: number;
      sellPrice: number;
      purchasePrice: number; // in USD
      sellRevenue: number; // in USD
      costBasis: number; // in USD
      realizedGain: number; // in USD
      realizedGainPct?: number;
      currency: string;
      rateToUsd: number;
    }> = [];

    txs.forEach((tx) => {
      const ticker = tx.ticker.toUpperCase().trim();
      if (!ticker) return;

      let sharesAllocated = 0;
      let costAllocated = 0;

      if (view === 'ownerA') {
        sharesAllocated = tx.personAShares;
        costAllocated = tx.personACostBasis;
      } else if (view === 'ownerB') {
        sharesAllocated = tx.personBShares;
        costAllocated = tx.personBCostBasis;
      } else {
        // Combined
        sharesAllocated = tx.quantity;
        costAllocated = tx.totalAmount;
      }

      // Base conversion rate (Tx to USD base)
      const rateToUsd = tx.currency.toUpperCase() === 'USD'
        ? 1.0
        : (tx.fxRate && tx.fxRate !== 1.0 ? tx.fxRate : this.service.getExchangeRate(tx.currency, 'USD'));

      const baseCost = costAllocated * rateToUsd;

      if (tx.type.toUpperCase() === 'BUY') {
        if (sharesAllocated > 0) {
          runningShares[ticker] = (runningShares[ticker] || 0) + sharesAllocated;
          runningCost[ticker] = (runningCost[ticker] || 0) + baseCost;
        }
      } else if (tx.type.toUpperCase() === 'SELL') {
        if (sharesAllocated > 0) {
          const currentShares = runningShares[ticker] || 0;
          const currentCost = runningCost[ticker] || 0;
          
          const avgCostBeforeSell = currentShares > 0 ? (currentCost / currentShares) : 0;
          const costOfSharesSold = sharesAllocated * avgCostBeforeSell;
          
          runningShares[ticker] = Math.max(0, currentShares - sharesAllocated);
          runningCost[ticker] = Math.max(0, currentCost - costOfSharesSold);

          const sellRevenueBase = baseCost;
          const realizedProfit = sellRevenueBase - costOfSharesSold;

          // Check if transaction date is within the current period filter
          const cleanDate = tx.date.slice(0, 10);
          const afterFrom = !from || cleanDate >= from;
          const beforeTo = !to || cleanDate <= to;

          if (afterFrom && beforeTo) {
            events.push({
              id: tx.id,
              date: tx.date,
              ticker: ticker,
              name: this.service.getTickerName(ticker, this.service.tickerConfigs()[ticker]?.name),
              shares: sharesAllocated,
              sellPrice: tx.price,
              purchasePrice: avgCostBeforeSell,
              sellRevenue: sellRevenueBase,
              costBasis: costOfSharesSold,
              realizedGain: realizedProfit,
              realizedGainPct: costOfSharesSold > 0 ? (realizedProfit / costOfSharesSold) * 100 : 0,
              currency: tx.currency,
              rateToUsd: rateToUsd
            } as any);
          }
        }
      }
    });

    // Filter by realized ticker search query
    const q = this.filterRealizedTicker().toUpperCase().trim();
    const filteredEvents = q
      ? events.filter(e => e.ticker.includes(q))
      : events;

    const field = this.sortByRealized();
    const dir = this.sortDirectionRealized();

    return [...filteredEvents].sort((a: any, b: any) => {
      let valA = a[field];
      let valB = b[field];

      if (field === 'realizedGain' && this.realizedLedgerSortMode() === 'pct') {
        valA = a.realizedGainPct || 0;
        valB = b.realizedGainPct || 0;
      }

      if (typeof valA === 'string') {
        valA = valA.toUpperCase();
        valB = (valB || '').toUpperCase();
      }

      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  });

  public realizedGainsTotals = computed(() => {
    const list = this.realizedGains();
    let totalShares = 0;
    let totalRevenue = 0;
    let totalCostBasis = 0;
    let totalRealized = 0;

    list.forEach(g => {
      totalShares += g.shares;
      totalRevenue += g.sellRevenue;
      totalCostBasis += g.costBasis;
      totalRealized += g.realizedGain;
    });

    return {
      shares: totalShares,
      revenue: totalRevenue,
      costBasis: totalCostBasis,
      realizedGain: totalRealized
    };
  });

  public clearDateFilter() {
    this.service.dateFrom.set('');
    this.service.dateTo.set('');
  }

  public setThisYear() {
    const currentYear = new Date().getFullYear();
    this.service.dateFrom.set(`${currentYear}-01-01`);
    this.service.dateTo.set(`${currentYear}-12-31`);
  }

  public setLastYear() {
    const lastYear = new Date().getFullYear() - 1;
    this.service.dateFrom.set(`${lastYear}-01-01`);
    this.service.dateTo.set(`${lastYear}-12-31`);
  }

  public toggleTable() {
    const expanding = this.isCollapsed();
    this.isCollapsed.set(!expanding);
    if (expanding) {
      // Was collapsed, now expanding — wait for *ngIf to render before scrolling
      setTimeout(() => {
        this.tableCard?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  }

  public scrollToTable(target?: string) {
    if (target === 'realized') {
      if (this.isRealizedCollapsed()) {
        this.isRealizedCollapsed.set(false);
        setTimeout(() => {
          this.realizedTableCard?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      } else {
        this.realizedTableCard?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      if (this.isCollapsed()) {
        this.isCollapsed.set(false);
        setTimeout(() => {
          this.tableCard?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      } else {
        this.tableCard?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  public async refreshMarketData() {
    this.isRefreshing.set(true);
    try {
      this.service.showToast('Forcing refresh of all market prices and FX rates...', 'info');
      await this.service.loadMarketPricesApi(true); // force
      await this.service.loadExchangeRatesApi(true); // force
      const now = Date.now();
      this.lastRefreshTime.set(now);
      this.service.showToast('All prices and exchange rates up to date!', 'success');
    } catch (e) {
      this.service.showToast('Refresh failed.', 'error');
    } finally {
      this.isRefreshing.set(false);
    }
  }

  public setSort(field: string) {
    if (field === 'unrealizedProfit') {
      if (this.sortBy() !== 'unrealizedProfit') {
        this.sortBy.set('unrealizedProfit');
        this.unrealizedSortMode.set('value');
        this.sortDirection.set('desc');
      } else {
        if (this.unrealizedSortMode() === 'value') {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.unrealizedSortMode.set('pct');
            this.sortDirection.set('desc');
          }
        } else {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.unrealizedSortMode.set('value');
            this.sortDirection.set('desc');
          }
        }
      }
    } else if (field === 'realizedProfit') {
      if (this.sortBy() !== 'realizedProfit') {
        this.sortBy.set('realizedProfit');
        this.realizedSortMode.set('value');
        this.sortDirection.set('desc');
      } else {
        if (this.realizedSortMode() === 'value') {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.realizedSortMode.set('pct');
            this.sortDirection.set('desc');
          }
        } else {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.realizedSortMode.set('value');
            this.sortDirection.set('desc');
          }
        }
      }
    } else if (field === 'totalReturn') {
      if (this.sortBy() !== 'totalReturn') {
        this.sortBy.set('totalReturn');
        this.totalReturnSortMode.set('value');
        this.sortDirection.set('desc');
      } else {
        if (this.totalReturnSortMode() === 'value') {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.totalReturnSortMode.set('pct');
            this.sortDirection.set('desc');
          }
        } else {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.totalReturnSortMode.set('value');
            this.sortDirection.set('desc');
          }
        }
      }
    } else {
      if (this.sortBy() === field) {
        this.sortDirection.update((d) => (d === 'desc' ? 'asc' : 'desc'));
      } else {
        this.sortBy.set(field);
        this.sortDirection.set(field === 'name' || field === 'ticker' || field === 'sector' ? 'asc' : 'desc');
      }
    }
  }

  public setSortRealized(field: string) {
    if (field === 'realizedGain') {
      if (this.sortByRealized() !== 'realizedGain') {
        this.sortByRealized.set('realizedGain');
        this.realizedLedgerSortMode.set('value');
        this.sortDirectionRealized.set('desc');
      } else {
        if (this.realizedLedgerSortMode() === 'value') {
          if (this.sortDirectionRealized() === 'desc') {
            this.sortDirectionRealized.set('asc');
          } else {
            this.realizedLedgerSortMode.set('pct');
            this.sortDirectionRealized.set('desc');
          }
        } else {
          if (this.sortDirectionRealized() === 'desc') {
            this.sortDirectionRealized.set('asc');
          } else {
            this.realizedLedgerSortMode.set('value');
            this.sortDirectionRealized.set('desc');
          }
        }
      }
    } else {
      if (this.sortByRealized() === field) {
        this.sortDirectionRealized.update((d) => (d === 'desc' ? 'asc' : 'desc'));
      } else {
        this.sortByRealized.set(field);
        this.sortDirectionRealized.set(field === 'date' || field === 'ticker' ? 'asc' : 'desc');
      }
    }
  }

  public filteredPositions = computed(() => {
    let list = this.summary().positions;
    const q = this.filterTicker().toUpperCase().trim();
    if (q) {
      list = list.filter((pos) => pos.ticker.toUpperCase().includes(q) || pos.name.toUpperCase().includes(q));
    }
    
    const field = this.sortBy();
    const dir = this.sortDirection();
    
    return [...list].sort((a: any, b: any) => {
      let valA = a[field];
      let valB = b[field];

      if (field === 'unrealizedProfit' && this.unrealizedSortMode() === 'pct') {
        valA = a.unrealizedReturnPct || 0;
        valB = b.unrealizedReturnPct || 0;
      } else if (field === 'realizedProfit' && this.realizedSortMode() === 'pct') {
        valA = a.realizedReturnPct || 0;
        valB = b.realizedReturnPct || 0;
      } else if (field === 'totalReturn' && this.totalReturnSortMode() === 'pct') {
        valA = a.totalReturnPct || 0;
        valB = b.totalReturnPct || 0;
      }
      
      if (typeof valA === 'string') {
        valA = valA.toUpperCase();
        valB = (valB || '').toUpperCase();
      }
      
      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  });

  // Compute active summary based on activeView
  public summary = computed<PersonPortfolioSummary>(() => {
    const view = this.activeView();
    if (view === 'ownerA') {
      return this.service.portfolioA();
    } else if (view === 'ownerB') {
      return this.service.portfolioB();
    } else {
      // Calculate Combined
      return this.calculateCombinedPortfolio();
    }
  });

  public unrealizedPercentage = computed(() => {
    const s = this.summary();
    if (s.totalCostBasis === 0) return 0;
    return (s.totalUnrealized / s.totalCostBasis) * 100;
  });

  public totalReturnPercentage = computed(() => {
    const s = this.summary();
    // Use all-time cost basis (no date filter) so % is always meaningful
    const allTimeA = this.service.portfolioA();
    const allTimeB = this.service.portfolioB();
    const allTimeCostBasis = allTimeA.totalCostBasis + allTimeB.totalCostBasis;
    if (allTimeCostBasis === 0) return 0;
    return (s.totalReturn / allTimeCostBasis) * 100;
  });

  // Color schemes for charts
  private colors = [
    '#00E5FF', // primary cyan
    '#8B5CF6', // secondary indigo
    '#D946EF', // pink accent
    '#10B981', // green success
    '#F59E0B', // amber
    '#EF4444', // red danger
    '#3B82F6', // blue
    '#6366F1', // indigo
    '#14B8A6', // teal
    '#84CC16', // lime
    '#EC4899', // pink
  ];

  public getColor(index: number): string {
    return this.colors[index % this.colors.length];
  }

  // Pre-calculate assets chart data
  public assetChartData = computed(() => {
    const s = this.summary();
    const isCost = this.allocationBasis() === 'cost';
    const total = isCost ? s.totalCostBasis : s.totalValue;
    if (total === 0) return [];
    
    return s.positions
      .filter((pos: PortfolioPosition) => (isCost ? pos.totalCost : pos.currentValue) > 0)
      .map((pos: PortfolioPosition) => {
        const val = isCost ? pos.totalCost : pos.currentValue;
        return {
          label: pos.ticker,
          value: val,
          pct: (val / total) * 100,
        };
      });
  });

  // Pre-calculate sectors chart data
  public sectorChartData = computed(() => {
    const s = this.summary();
    const isCost = this.allocationBasis() === 'cost';
    const total = isCost ? s.totalCostBasis : s.totalValue;
    if (total === 0) return [];

    const sectorsMap = new Map<string, number>();
    s.positions.forEach((pos: PortfolioPosition) => {
      const val = isCost ? pos.totalCost : pos.currentValue;
      if (val <= 0) return;
      const sec = pos.sector || 'Other';
      sectorsMap.set(sec, (sectorsMap.get(sec) || 0) + val);
    });

    const sectors: { label: string; value: number; pct: number }[] = [];
    sectorsMap.forEach((val, key) => {
      sectors.push({
        label: key,
        value: val,
        pct: (val / total) * 100,
      });
    });

    return sectors.sort((a, b) => b.value - a.value);
  });

  // Compute details of the hovered asset stock
  public hoveredAssetDetail = computed(() => {
    const idx = this.hoveredAssetIndex();
    const data = this.assetChartData();
    if (idx === -1 || !data[idx]) return null;
    
    const ticker = data[idx].label;
    const s = this.summary();
    const pos = s.positions.find(p => p.ticker === ticker);
    if (!pos) return null;
    
    const displayCurr = this.displayCurrency();
    const targetCurr = displayCurr === 'native' ? (pos.currency || 'EUR') : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = targetCurr === 'USD' ? '$' : (targetCurr === 'EUR' ? '€' : '£');
    
    const fxRate = this.displayCurrency() === 'USD' ? 1.0 : this.service.getExchangeRate('USD', 'EUR');
    const displaySymbol = this.displayCurrency() === 'USD' ? '$' : '€';
    
    const isCost = this.allocationBasis() === 'cost';
    const rawVal = isCost ? pos.totalCost : pos.currentValue;

    return {
      ticker: pos.ticker,
      name: pos.name,
      sector: pos.sector || 'Other',
      pct: data[idx].pct,
      valueFormatted: displaySymbol + Math.round(rawVal * fxRate).toLocaleString(),
      shares: pos.totalShares
    };
  });

  public showNativePicker(inputEl: HTMLInputElement) {
    try {
      inputEl.showPicker();
    } catch (err) {
      // Fallback
    }
  }

  // Compute stocks belonging to the hovered sector
  public hoveredSectorStocks = computed(() => {
    const idx = this.hoveredSectorIndex();
    const data = this.sectorChartData();
    if (idx === -1 || !data[idx]) return [];
    
    const sectorName = data[idx].label;
    const s = this.summary();
    const rate = this.displayCurrency() === 'USD' ? 1.0 : this.service.getExchangeRate('USD', 'EUR');
    const symbol = this.displayCurrency() === 'USD' ? '$' : '€';
    
    const isCost = this.allocationBasis() === 'cost';
    return s.positions
      .filter(p => (p.sector || 'Other') === sectorName && (isCost ? p.totalCost : p.currentValue) > 0)
      .map(p => {
        const val = isCost ? p.totalCost : p.currentValue;
        return {
          ticker: p.ticker,
          pct: (val / data[idx].value) * 100,
          valueFormatted: symbol + Math.round(val * rate).toLocaleString()
        };
      })
      .sort((a, b) => b.pct - a.pct);
  });

  public getSectorColor(index: number): string {
    return this.getColor(index + 5);
  }

  constructor() {
    const timeStr = localStorage.getItem('pt_last_refresh_time');
    if (timeStr) {
      this.lastRefreshTime.set(parseInt(timeStr, 10));
    }

    // Redraw charts when data changes or display currency toggles
    effect(() => {
      // Trigger evaluation of dependencies
      const assetData = this.assetChartData();
      const sectorData = this.sectorChartData();
      this.displayCurrency(); // Register dependency
      this.service.dateFrom(); // Re-draw when date filter changes
      this.service.dateTo();
      
      // Wait a tick for DOM updates
      setTimeout(() => {
        this.drawCharts(assetData, sectorData);
      }, 50);
    });
  }

  ngAfterViewInit() {
    this.drawCharts(this.assetChartData(), this.sectorChartData());
    this.setupChartEvents();
  }

  private setupChartEvents() {
    const attachHoverListener = (
      canvasRef: ElementRef<HTMLCanvasElement>,
      getData: () => { label: string; value: number; pct: number }[],
      setHoveredIndex: (idx: number) => void
    ) => {
      const canvas = canvasRef.nativeElement;
      
      canvas.addEventListener('mousemove', (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const cx = 460 / 2;
        const cy = 320 / 2;
        const radius = Math.min(cx, cy) - 40;
        const innerRadius = radius * 0.50;
        
        const dx = x - cx;
        const dy = y - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const data = getData();
        if (distance >= innerRadius && distance <= radius && data.length > 0) {
          let angle = Math.atan2(dy, dx);
          // Transform angle to start at 12 o'clock (-0.5 * PI) and increase clockwise (0 to 2*PI)
          let normalizedAngle = angle + 0.5 * Math.PI;
          if (normalizedAngle < 0) {
            normalizedAngle += 2 * Math.PI;
          }
          
          let currentAngle = 0;
          let hoveredIndex = -1;
          for (let i = 0; i < data.length; i++) {
            const sliceAngle = (data[i].pct / 100) * 2 * Math.PI;
            if (normalizedAngle >= currentAngle && normalizedAngle < currentAngle + sliceAngle) {
              hoveredIndex = i;
              break;
            }
            currentAngle += sliceAngle;
          }
          
          setHoveredIndex(hoveredIndex);
        } else {
          setHoveredIndex(-1);
        }
      });
      
      canvas.addEventListener('mouseleave', () => {
        setHoveredIndex(-1);
      });
    };

    if (this.assetCanvas) {
      attachHoverListener(this.assetCanvas, () => this.assetChartData(), (idx) => {
        if (this.hoveredAssetIndex() !== idx) {
          this.hoveredAssetIndex.set(idx);
          this.drawCharts(this.assetChartData(), this.sectorChartData());
        }
      });
    }

    if (this.sectorCanvas) {
      attachHoverListener(this.sectorCanvas, () => this.sectorChartData(), (idx) => {
        if (this.hoveredSectorIndex() !== idx) {
          this.hoveredSectorIndex.set(idx);
          this.drawCharts(this.assetChartData(), this.sectorChartData());
        }
      });
    }
  }

  public formatVal(val: number, fromCurrency: string = 'USD', decimals: number = 2, nativeCurrency?: string): string {
    const displayCurr = this.displayCurrency();
    const targetCurr = displayCurr === 'native'
      ? (nativeCurrency || 'EUR')
      : displayCurr;
    const rate = this.service.getExchangeRate(fromCurrency, targetCurr);
    const converted = val * rate;
    const symbol = targetCurr === 'USD' ? '$' : (targetCurr === 'EUR' ? '€' : '£');
    return symbol + converted.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  public formatValShort(val: number, fromCurrency: string = 'USD'): string {
    const displayCurr = this.displayCurrency();
    const targetCurr = displayCurr === 'native' ? 'EUR' : displayCurr;
    const rate = this.service.getExchangeRate(fromCurrency, targetCurr);
    const converted = val * rate;
    const symbol = targetCurr === 'USD' ? '$' : (targetCurr === 'EUR' ? '€' : '£');
    return symbol + Math.round(converted).toLocaleString('en-US');
  }

  public getPositionUnrealizedPct(pos: PortfolioPosition): number {
    const basis = pos.totalShares * pos.averageCost;
    if (basis === 0) return 0;
    return (pos.unrealizedProfit / basis) * 100;
  }

  private calculateCombinedPortfolio(): PersonPortfolioSummary {
    const summaryA = this.service.portfolioA();
    const summaryB = this.service.portfolioB();
    
    // Combine positions
    const positionsMap = new Map<string, PortfolioPosition>();

    const addPositionsFromSummary = (s: PersonPortfolioSummary) => {
      s.positions.forEach((pos) => {
        if (!positionsMap.has(pos.ticker)) {
          positionsMap.set(pos.ticker, { ...pos });
        } else {
          const existing = positionsMap.get(pos.ticker)!;
          const totalShares = existing.totalShares + pos.totalShares;
          
          // Weighted Average Cost for combined
          const totalCostBasis = (existing.totalShares * existing.averageCost) + (pos.totalShares * pos.averageCost);
          const combinedAvgCost = totalShares > 0 ? totalCostBasis / totalShares : 0;
          
          existing.totalShares = parseFloat(totalShares.toFixed(6));
          existing.averageCost = parseFloat(combinedAvgCost.toFixed(4));
          existing.totalCost = parseFloat((existing.totalCost + pos.totalCost).toFixed(2));
          existing.currentValue = parseFloat((existing.currentValue + pos.currentValue).toFixed(2));
          existing.unrealizedProfit = parseFloat((existing.unrealizedProfit + pos.unrealizedProfit).toFixed(2));
          existing.realizedProfit = parseFloat((existing.realizedProfit + pos.realizedProfit).toFixed(2));
          existing.dividends = parseFloat((existing.dividends + pos.dividends).toFixed(2));
          existing.totalReturn = parseFloat((existing.totalReturn + pos.totalReturn).toFixed(2));
        }
      });
    };

    addPositionsFromSummary(summaryA);
    addPositionsFromSummary(summaryB);

    const positions = Array.from(positionsMap.values());
    positions.sort((a, b) => b.currentValue - a.currentValue);

    return {
      ownerName: 'Combined',
      positions,
      totalValue: parseFloat((summaryA.totalValue + summaryB.totalValue).toFixed(2)),
      totalCostBasis: parseFloat((summaryA.totalCostBasis + summaryB.totalCostBasis).toFixed(2)),
      totalUnrealized: parseFloat((summaryA.totalUnrealized + summaryB.totalUnrealized).toFixed(2)),
      totalRealized: parseFloat((summaryA.totalRealized + summaryB.totalRealized).toFixed(2)),
      totalDividends: parseFloat((summaryA.totalDividends + summaryB.totalDividends).toFixed(2)),
      totalReturn: parseFloat((summaryA.totalReturn + summaryB.totalReturn).toFixed(2)),
    };
  }

  // Pure canvas chart painting
  private drawCharts(
    assets: { label: string; value: number; pct: number }[],
    sectors: { label: string; value: number; pct: number }[]
  ) {
    this.drawDonutChart(this.assetCanvas, assets, 'Assets');
    this.drawDonutChart(this.sectorCanvas, sectors, 'Sectors');
  }

  private drawDonutChart(
    canvasRef: ElementRef<HTMLCanvasElement> | undefined,
    data: { label: string; value: number; pct: number }[],
    centerText: string
  ) {
    if (!canvasRef) return;
    const canvas = canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale canvas to match high-resolution screens (Retina displays)
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = 500;
    const displayHeight = 320;

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const cx = displayWidth / 2;
    const cy = displayHeight / 2;
    const radius = Math.min(cx, cy) - 52;
    const innerRadius = radius * 0.48;

    if (data.length === 0) {
      // Draw empty placeholder circle
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 15;
      ctx.stroke();
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '500 13px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No Data', cx, cy);
      return;
    }

    let startAngle = -0.5 * Math.PI; // Start at 12 o'clock
    const hoveredIdx = centerText === 'Assets' ? this.hoveredAssetIndex() : this.hoveredSectorIndex();
    const usedYRight: number[] = [];
    const usedYLeft: number[] = [];

    data.forEach((item, index) => {
      const sliceAngle = (item.pct / 100) * 2 * Math.PI;
      const endAngle = startAngle + sliceAngle;
      
      const isHovered = (index === hoveredIdx);
      const strokeWidth = radius - innerRadius;

      ctx.beginPath();
      ctx.arc(cx, cy, (radius + innerRadius) / 2, startAngle, endAngle);
      ctx.strokeStyle = this.getColor(centerText === 'Assets' ? index : index + 5);
      ctx.lineWidth = isHovered ? strokeWidth + 4 : strokeWidth;
      ctx.lineCap = 'butt';
      ctx.stroke();

      // Draw label
      const labelText = `${item.label} ${item.pct.toFixed(1)}%`;
      const middleAngle = startAngle + sliceAngle / 2;

      // Always draw labels OUTSIDE the chart with a pointer line to prevent slice text overflow
        // Draw OUTSIDE the chart with a pointer line for small slices
        const startRad = (radius + innerRadius) / 2;
        const sx = cx + startRad * Math.cos(middleAngle);
        const sy = cy + startRad * Math.sin(middleAngle);
        
        const elbowRad = radius + 15;
        const ex = cx + elbowRad * Math.cos(middleAngle);
        const ey = cy + elbowRad * Math.sin(middleAngle);
        
        const isRight = Math.cos(middleAngle) >= 0;
        const lineLength = 12;
        
        let finalY = ey;
        const minDistance = 11;
        const usedY = isRight ? usedYRight : usedYLeft;

        let collision = true;
        let shiftCount = 0;
        while (collision && shiftCount < 40) {
          collision = false;
          for (const prevY of usedY) {
            if (Math.abs(finalY - prevY) < minDistance) {
              finalY += (finalY >= cy ? 1.5 : -1.5);
              collision = true;
              break;
            }
          }
          shiftCount++;
        }
        usedY.push(finalY);

        const tx = ex + (isRight ? lineLength : -lineLength);
        const ty = finalY;

        ctx.save();
        // Draw subtle pointer line
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, finalY);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw label text next to line end
        ctx.fillStyle = '#9ca3af';
        ctx.font = '500 9px Outfit';
        ctx.textAlign = isRight ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        
        const textX = tx + (isRight ? 4 : -4);
        ctx.fillText(labelText, textX, ty);
        ctx.restore();

      // Divider lines
      if (data.length > 1) {
        ctx.beginPath();
        ctx.moveTo(cx + innerRadius * Math.cos(startAngle), cy + innerRadius * Math.sin(startAngle));
        ctx.lineTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
        ctx.strokeStyle = '#080c14'; // match page bg
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      startAngle = endAngle;
    });

    const symbol = this.displayCurrency() === 'USD' ? '$' : '€';
    const rate = this.displayCurrency() === 'USD' ? 1.0 : this.service.getExchangeRate('USD', 'EUR');

    if (hoveredIdx !== -1 && data[hoveredIdx]) {
      const hoveredItem = data[hoveredIdx];
      // Draw hovered slice label
      ctx.fillStyle = '#f3f4f6';
      ctx.font = '700 17px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      let lbl = hoveredItem.label;
      if (lbl.length > 10) {
        lbl = lbl.substring(0, 9) + '..';
      }
      ctx.fillText(lbl, cx, cy - 10);

      // Draw hovered slice value and percentage in slice color
      ctx.fillStyle = this.getColor(centerText === 'Assets' ? hoveredIdx : hoveredIdx + 5);
      ctx.font = '600 12px Outfit';
      const valStr = symbol + Math.round(hoveredItem.value * rate).toLocaleString();
      const pctStr = hoveredItem.pct.toFixed(1) + '%';
      ctx.fillText(`${valStr} (${pctStr})`, cx, cy + 12);
    } else {
      // Draw center label
      ctx.fillStyle = '#f3f4f6';
      ctx.font = '600 17px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(centerText, cx, cy - 10);

      ctx.fillStyle = '#9ca3af';
      ctx.font = '400 12px Outfit';
      
      let totalVal = data.reduce((sum, item) => sum + item.value, 0);
      const convertedTotal = totalVal * rate;
      ctx.fillText(symbol + Math.round(convertedTotal).toLocaleString(), cx, cy + 12);
    }
  }
}
