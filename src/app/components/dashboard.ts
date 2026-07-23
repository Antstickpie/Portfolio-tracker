import { Component, inject, signal, computed, effect, ElementRef, ViewChild, AfterViewInit, OnDestroy, ChangeDetectorRef, HostListener, untracked } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
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
export class DashboardComponent implements AfterViewInit, OnDestroy {
  private activeIntervalId: any = null;
  private timeAgoIntervalId: any = null;
  private handleVisibilityChangeBind = this.handleVisibilityChange.bind(this);
  private lastActivityTime = Date.now();
  private onUserActivity = () => {
    this.lastActivityTime = Date.now();
  };
  @HostListener('window:resize')
  onResize() {
    const assetData = this.assetChartData();
    const sectorData = this.sectorChartData();
    this.drawCharts(assetData, sectorData);
  }

  public service = inject(PortfolioService);
  private cdr = inject(ChangeDetectorRef);
  private datePipe = new DatePipe('en-US');

  @ViewChild('chartSvg') chartSvg!: ElementRef<SVGElement>;
  @ViewChild('assetCanvas') assetCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sectorCanvas') sectorCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('tableCard') tableCard!: ElementRef<HTMLElement>;
  @ViewChild('realizedTableCard') realizedTableCard!: ElementRef<HTMLElement>;

  // Combined, ownerA, or ownerB
  public activeView = signal<'combined' | 'ownerA' | 'ownerB'>('combined');
  public displayCurrency = this.service.displayCurrency;
  public historyPeriod = signal<'all' | '1y' | '6m' | '3m' | '1m' | '1w'>('1m');

  // Hovered slice states (using Signals so calculated values updates are reactive)
  public hoveredAssetIndex = signal<number>(-1);
  public hoveredSectorIndex = signal<number>(-1);

  // SVG Chart State Properties
  public chartPoints: {
    date: Date;
    dateStr: string;
    invested: number;
    value: number;
    shares?: number;
    avgCost?: number;
    x: number;
    yInv: number;
    yVal: number;
  }[] = [];

  public investedPath = '';
  public valuePath = '';
  public fillPath = '';
  
  public chartMinVal = 0;
  public chartMaxVal = 100;
  public yTicks: { valText: string; y: number }[] = [];
  public xTicks: { dateStr: string; x: number }[] = [];
  public svgThemeColor = '#10b981';
  public svgFillGradStr = '16, 185, 129';
  public hoveredPt: any = null;
  public lineGradStops: { offset: string; color: string }[] = [];
  public gradientId = 'chartLineGrad_0';
  private gradientCounter = 0;
  private chartLoadSession = 0;

  public onChartMouseMove(event: MouseEvent) {
    if (this.chartPoints.length === 0 || !this.chartSvg) return;
    const svgElement = this.chartSvg.nativeElement as any;
    const pt = svgElement.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const screenCTM = svgElement.getScreenCTM();
    if (!screenCTM) return;
    const svgPoint = pt.matrixTransform(screenCTM.inverse());
    const svgX = svgPoint.x;

    const svgY = svgPoint.y;

    let pLeft = this.chartPoints[0];
    let pRight = this.chartPoints[this.chartPoints.length - 1];

    if (svgX < pLeft.x || svgX > pRight.x) {
      this.hoveredPt = null;
    } else {
      for (let i = 0; i < this.chartPoints.length - 1; i++) {
        const p1 = this.chartPoints[i];
        const p2 = this.chartPoints[i + 1];
        if (svgX >= p1.x && svgX <= p2.x) {
          pLeft = p1;
          pRight = p2;
          break;
        }
      }

      const t = (svgX - pLeft.x) / (pRight.x - pLeft.x || 1);
      const interpolatedValue = pLeft.value + t * (pRight.value - pLeft.value);
      const interpolatedInvested = pLeft.invested + t * (pRight.invested - pLeft.invested);
      const interpolatedShares = (pLeft.shares || 0) + t * ((pRight.shares || 0) - (pLeft.shares || 0));
      const interpolatedAvgCost = (pLeft.avgCost || 0) + t * ((pRight.avgCost || 0) - (pLeft.avgCost || 0));
      const t2 = t * t;
      const t3 = t2 * t;
      const w1 = 1 - 3 * t2 + 2 * t3;
      const w2 = 3 * t2 - 2 * t3;
      const interpolatedYVal = pLeft.yVal * w1 + pRight.yVal * w2;
      const interpolatedYInv = pLeft.yInv * w1 + pRight.yInv * w2;

      const interpolatedTime = pLeft.date.getTime() + t * (pRight.date.getTime() - pLeft.date.getTime());
      const interpolatedDate = new Date(interpolatedTime);
      const dateStr = this.datePipe.transform(interpolatedDate, this.service.dateFormat()) || '';

      this.hoveredPt = {
        date: interpolatedDate,
        dateStr,
        invested: interpolatedInvested,
        value: interpolatedValue,
        shares: interpolatedShares,
        avgCost: interpolatedAvgCost,
        x: svgX,
        yInv: interpolatedYInv,
        yVal: interpolatedYVal
      };
    }


  }

  public onChartMouseLeave() {
    this.hoveredPt = null;
  }

  public getTooltipTop(hoveredPt: any, svgElement: any): number {
    if (!hoveredPt || !svgElement) return 50;
    const clientHeight = svgElement.clientHeight || 320;
    const higherY = Math.min(hoveredPt.yVal, hoveredPt.yInv);
    return (higherY / 320) * clientHeight;
  }

  public getTooltipLeft(hoveredPt: any, svgElement: any): number {
    if (!hoveredPt || !svgElement) return 0;
    const clientWidth = svgElement.clientWidth || 1000;
    const screenX = hoveredPt.x * (clientWidth / 1000);
    return Math.max(10, Math.min(clientWidth - 180, screenX - 85));
  }

  // Filter and sort holdings state
  public filterTicker = signal<string>('');
  public filterRealizedTicker = signal<string>('');
  public sortBy = signal<string>('currentValue');
  public sortDirection = signal<'asc' | 'desc'>('desc');
  public sortByRealized = signal<string>('realizedGain');
  public sortDirectionRealized = signal<'asc' | 'desc'>('desc');
  public unrealizedSortMode = signal<'value' | 'pct'>('value');
  public averageCostSortMode = signal<'value' | 'pct'>('value');
  public currentPriceSortMode = signal<'value' | 'pct'>('value');
  public realizedSortMode = signal<'value' | 'pct'>('value');
  public totalReturnSortMode = signal<'value' | 'pct'>('value');
  public realizedLedgerSortMode = signal<'value' | 'pct'>('value');
  public totalCostSortMode = signal<'value' | 'pct'>('value');
  public currentValueSortMode = signal<'value' | 'pct'>('value');
  public allocationBasis = signal<'value' | 'cost'>('value');
  public currentYear = new Date().getFullYear();
  public isCollapsed = signal<boolean>(false);
  public isRealizedCollapsed = signal<boolean>(false);
  public isChartsCollapsed = signal<boolean>(false);
  public isRefreshing = this.service.isSyncing;

  // Computed signal to calculate detailed realized gain events (chronologically correct avg cost, filtered by date)
  public realizedGains = computed(() => {
    const rawTxs = this.service.activeTransactions();
    const from = this.service.dateFrom();
    const to = this.service.dateTo();
    const view = this.activeView();
    
    // Sort all transactions chronologically (oldest first) to compute running avg costs correctly
    const txs = [...rawTxs]
      .filter(tx => !this.service.disabledSources().includes(tx.source || ''))
      .sort((a, b) => {
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (diff !== 0) return diff;
      const typeOrder = { 'BUY': 1, 'SELL': 2, 'DIVIDEND': 3 } as any;
      const orderA = typeOrder[a.type.toUpperCase()] || 9;
      const orderB = typeOrder[b.type.toUpperCase()] || 9;
      return orderA - orderB;
    });

    const runningShares = {} as Record<string, number>;
    const runningCostTarget = {} as Record<string, number>; // in target display currency
    // FIFO lot tracking for realized gains ledger
    const fifoLotsTarget = {} as Record<string, { shares: number; costPerShare: number }[]>;
    const useFifo = this.service.costBasisMethod() === 'fifo';

    const events: Array<{
      id: string;
      date: string;
      ticker: string;
      name: string;
      shares: number;
      sellPrice: number;
      purchasePrice: number; // USD equivalent today
      sellRevenue: number; // USD equivalent today
      costBasis: number; // USD equivalent today
      realizedGain: number; // USD equivalent today
      realizedGainPct?: number;
      currency: string;
      rateToUsd: number;
    }> = [];

    txs.forEach((tx) => {
      const ticker = tx.ticker.toUpperCase().trim();
      if (!ticker) return;

      const displayCurr = this.service.displayCurrency();
      const targetCurrency = displayCurr === 'native'
        ? tx.currency.toUpperCase()
        : displayCurr.toUpperCase();

      const targetRateToday = this.service.getExchangeRate('USD', targetCurrency);

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

      const cfg = this.service.tickerConfigs()[ticker];
      // Apply stock splits — skip for sources marked as split-adjusted
      const isSplitAdjustedSource = this.service.splitAdjustedSources().includes(tx.source || '');
      if (!isSplitAdjustedSource && cfg?.splits?.length && tx.date) {
        for (const sp of cfg.splits) {
          if (tx.date.slice(0, 10) < sp.date) {
            sharesAllocated *= sp.ratio;
          }
        }
      } else if (!isSplitAdjustedSource && cfg && cfg.splitRatio && cfg.splitDate && tx.date && tx.date.slice(0, 10) < cfg.splitDate) {
        sharesAllocated *= cfg.splitRatio;
      }

      // Exchange rate from transaction currency to target currency.
      // EUR uses annual average exchange rate tax rule; other currencies use daily rate.
      let rateToTarget = 1.0;
      if (targetCurrency === 'EUR' && tx.date) {
        const txYear = parseInt(tx.date.slice(0, 4)) || new Date().getFullYear();
        rateToTarget = this.service.getYearlyAverageExchangeRate(tx.currency, targetCurrency, txYear);
      } else {
        rateToTarget = this.service.getExchangeRate(tx.currency, targetCurrency, tx.date);
      }

      let pureCostAllocated = costAllocated;
      const ownerFraction = tx.quantity > 0 ? (sharesAllocated / tx.quantity) : 0;
      const txFees = (tx.fees || 0) * ownerFraction;
      if (tx.price && tx.price > 0 && sharesAllocated > 0) {
        pureCostAllocated = sharesAllocated * tx.price;
      } else if (txFees > 0 && costAllocated > txFees) {
        pureCostAllocated = costAllocated - txFees;
      }
      const targetCost = pureCostAllocated * rateToTarget;

      if (tx.type.toUpperCase() === 'BUY') {
        if (sharesAllocated > 0) {
          runningShares[ticker] = (runningShares[ticker] || 0) + sharesAllocated;
          runningCostTarget[ticker] = (runningCostTarget[ticker] || 0) + targetCost;
          if (useFifo) {
            if (!fifoLotsTarget[ticker]) fifoLotsTarget[ticker] = [];
            fifoLotsTarget[ticker].push({ shares: sharesAllocated, costPerShare: targetCost / sharesAllocated });
          }
        }
      } else if (tx.type.toUpperCase() === 'SELL') {
        if (sharesAllocated > 0) {
          const currentShares = runningShares[ticker] || 0;
          const currentCostTarget = runningCostTarget[ticker] || 0;
          
          let costOfSharesSoldTarget = 0;
          let avgCostBeforeSellTarget = 0;

          if (useFifo) {
            const lots = fifoLotsTarget[ticker] || [];
            let remaining = sharesAllocated;
            while (remaining > 0 && lots.length > 0) {
              const lot = lots[0];
              const take = Math.min(remaining, lot.shares);
              costOfSharesSoldTarget += take * lot.costPerShare;
              lot.shares -= take;
              remaining -= take;
              if (lot.shares <= 0.000001) {
                lots.shift();
              }
            }
            avgCostBeforeSellTarget = sharesAllocated > 0 ? costOfSharesSoldTarget / sharesAllocated : 0;
          } else {
            avgCostBeforeSellTarget = currentShares > 0 ? (currentCostTarget / currentShares) : 0;
            costOfSharesSoldTarget = sharesAllocated * avgCostBeforeSellTarget;
          }
          
          runningShares[ticker] = Math.max(0, currentShares - sharesAllocated);
          runningCostTarget[ticker] = Math.max(0, currentCostTarget - costOfSharesSoldTarget);

          const sellRevenueTarget = targetCost;
          const realizedProfitTarget = sellRevenueTarget - costOfSharesSoldTarget;

          // Check if transaction date is within the current period filter
          const cleanDate = tx.date.slice(0, 10);
          const afterFrom = !from || cleanDate >= from;
          const beforeTo = !to || cleanDate <= to;

          if (afterFrom && beforeTo) {
            // Translate target currency values back to USD equivalents using today's rate
            const sellRevenueBase = sellRevenueTarget / targetRateToday;
            const costBasisBase = costOfSharesSoldTarget / targetRateToday;
            const realizedProfitBase = realizedProfitTarget / targetRateToday;
            const avgCostBeforeSellBase = avgCostBeforeSellTarget / targetRateToday;
            const sellPriceBase = (tx.price * rateToTarget) / targetRateToday;

            events.push({
              id: tx.id,
              date: tx.date,
              ticker: ticker,
              name: this.service.getTickerName(ticker, this.service.tickerConfigs()[ticker]?.name),
              shares: sharesAllocated,
              sellPrice: sellPriceBase,
              purchasePrice: avgCostBeforeSellBase,
              sellRevenue: sellRevenueBase,
              costBasis: costBasisBase,
              realizedGain: realizedProfitBase,
              realizedGainPct: costOfSharesSoldTarget > 0 ? (realizedProfitTarget / costOfSharesSoldTarget) * 100 : 0,
              currency: tx.currency,
              rateToUsd: rateToTarget
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

  public expandedRealizedTickers = signal<string[]>([]);

  public toggleRealizedTicker(ticker: string) {
    const list = this.expandedRealizedTickers();
    if (list.includes(ticker)) {
      this.expandedRealizedTickers.set(list.filter(t => t !== ticker));
    } else {
      this.expandedRealizedTickers.set([...list, ticker]);
    }
  }

  public groupedRealizedGains = computed(() => {
    const list = this.realizedGains();
    const map = new Map<string, {
      ticker: string;
      name: string;
      shares: number;
      sellRevenue: number;
      costBasis: number;
      realizedGain: number;
      currency: string;
      sales: typeof list;
    }>();

    list.forEach(g => {
      if (!map.has(g.ticker)) {
        map.set(g.ticker, {
          ticker: g.ticker,
          name: g.name,
          shares: 0,
          sellRevenue: 0,
          costBasis: 0,
          realizedGain: 0,
          currency: g.currency,
          sales: []
        });
      }
      const agg = map.get(g.ticker)!;
      agg.shares += g.shares;
      agg.sellRevenue += g.sellRevenue;
      agg.costBasis += g.costBasis;
      agg.realizedGain += g.realizedGain;
      agg.sales.push(g);
    });

    const result = Array.from(map.values()).map(agg => {
      const avgSellPrice = agg.shares > 0 ? (agg.sellRevenue / agg.shares) : 0;
      const avgPurchasePrice = agg.shares > 0 ? (agg.costBasis / agg.shares) : 0;
      const realizedGainPct = agg.costBasis > 0 ? (agg.realizedGain / agg.costBasis) * 100 : 0;
      return {
        ...agg,
        sellPrice: avgSellPrice,
        purchasePrice: avgPurchasePrice,
        realizedGainPct
      };
    });

    const field = this.sortByRealized();
    const dir = this.sortDirectionRealized();

    return result.sort((a: any, b: any) => {
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

  public clearDateFilter() {
    const txs = this.service.transactions();
    if (txs.length > 0) {
      const dates = txs.map(t => t.date ? t.date.slice(0, 10) : '').filter(Boolean).sort();
      if (dates.length > 0) {
        this.service.dateFrom.set(dates[0]);
        this.service.dateTo.set(dates[dates.length - 1]);
        return;
      }
    }
    this.service.dateFrom.set('');
    this.service.dateTo.set('');
  }

  public isAllTimeActive(): boolean {
    const from = this.service.dateFrom();
    const to = this.service.dateTo();
    if (!from && !to) return true;
    const txs = this.service.transactions();
    if (txs.length > 0) {
      const dates = txs.map(t => t.date ? t.date.slice(0, 10) : '').filter(Boolean).sort();
      if (dates.length > 0) {
        return from === dates[0] && to === dates[dates.length - 1];
      }
    }
    return false;
  }

  public setThisYear() {
    const range = this.service.getYearRange(0);
    this.service.dateFrom.set(range.from);
    this.service.dateTo.set(range.to);
  }

  public isThisYearActive(): boolean {
    const range = this.service.getYearRange(0);
    return this.service.dateFrom() === range.from && this.service.dateTo() === range.to;
  }

  public shiftYear(direction: number) {
    const fromVal = this.service.dateFrom();
    let currentYear = new Date().getFullYear();
    if (fromVal) {
      const parts = fromVal.split('-');
      if (parts.length > 0) {
        const y = parseInt(parts[0], 10);
        if (!isNaN(y)) {
          currentYear = y;
        }
      }
    }
    const targetYear = currentYear + direction;
    this.service.dateFrom.set(`${targetYear}-01-01`);
    this.service.dateTo.set(`${targetYear}-12-31`);
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
    await this.service.refreshMarketData(true);
  }

  public setSort(field: string) {
    if (field === 'currentPrice') {
      if (this.sortBy() !== 'currentPrice') {
        this.sortBy.set('currentPrice');
        this.currentPriceSortMode.set('value');
        this.sortDirection.set('desc');
      } else {
        if (this.currentPriceSortMode() === 'value') {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.currentPriceSortMode.set('pct');
            this.sortDirection.set('desc');
          }
        } else {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.currentPriceSortMode.set('value');
            this.sortDirection.set('desc');
          }
        }
      }
    } else if (field === 'averageCost') {
      if (this.sortBy() !== 'averageCost') {
        this.sortBy.set('averageCost');
        this.averageCostSortMode.set('value');
        this.sortDirection.set('desc');
      } else {
        if (this.averageCostSortMode() === 'value') {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.averageCostSortMode.set('pct');
            this.sortDirection.set('desc');
          }
        } else {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.averageCostSortMode.set('value');
            this.sortDirection.set('desc');
          }
        }
      }
    } else if (field === 'totalCost') {
      if (this.sortBy() !== 'totalCost') {
        this.sortBy.set('totalCost');
        this.totalCostSortMode.set('value');
        this.sortDirection.set('desc');
      } else {
        if (this.totalCostSortMode() === 'value') {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.totalCostSortMode.set('pct');
            this.sortDirection.set('desc');
          }
        } else {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.totalCostSortMode.set('value');
            this.sortDirection.set('desc');
          }
        }
      }
    } else if (field === 'currentValue') {
      if (this.sortBy() !== 'currentValue') {
        this.sortBy.set('currentValue');
        this.currentValueSortMode.set('value');
        this.sortDirection.set('desc');
      } else {
        if (this.currentValueSortMode() === 'value') {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.currentValueSortMode.set('pct');
            this.sortDirection.set('desc');
          }
        } else {
          if (this.sortDirection() === 'desc') {
            this.sortDirection.set('asc');
          } else {
            this.currentValueSortMode.set('value');
            this.sortDirection.set('desc');
          }
        }
      }
    } else if (field === 'unrealizedProfit') {
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
    
    const totalCostSum = list.reduce((sum, p) => sum + (p.totalCost || 0), 0);
    const totalValueSum = list.reduce((sum, p) => sum + (p.currentValue || 0), 0);
    
    return [...list].sort((a: any, b: any) => {
      let valA = a[field];
      let valB = b[field];

      if (field === 'currentPrice' && this.currentPriceSortMode() === 'pct') {
        valA = a.unrealizedReturnPct || 0;
        valB = b.unrealizedReturnPct || 0;
      } else if (field === 'averageCost' && this.averageCostSortMode() === 'pct') {
        valA = a.unrealizedReturnPct || 0;
        valB = b.unrealizedReturnPct || 0;
      } else if (field === 'totalCost' && this.totalCostSortMode() === 'pct') {
        valA = totalCostSum > 0 ? (a.totalCost / totalCostSum) * 100 : 0;
        valB = totalCostSum > 0 ? (b.totalCost / totalCostSum) * 100 : 0;
      } else if (field === 'currentValue' && this.currentValueSortMode() === 'pct') {
        valA = totalValueSum > 0 ? (a.currentValue / totalValueSum) * 100 : 0;
        valB = totalValueSum > 0 ? (b.currentValue / totalValueSum) * 100 : 0;
      } else if (field === 'unrealizedProfit' && this.unrealizedSortMode() === 'pct') {
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

  public tableTotals = computed(() => {
    let cost = 0;
    let value = 0;
    let dividends = 0;
    let realized = 0;
    this.filteredPositions().forEach(pos => {
      cost += pos.totalCost;
      value += pos.currentValue;
      dividends += pos.dividends;
      realized += pos.realizedProfit;
    });
    const unrealized = value - cost;
    const totalReturn = unrealized + realized + dividends;
    return {
      cost,
      value,
      dividends,
      realized,
      unrealized,
      totalReturn
    };
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
    
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? (pos.currency || this.service.defaultCurrency()) : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);
    
    const isCost = this.allocationBasis() === 'cost';
    const rawVal = isCost ? pos.totalCost : pos.currentValue;

    return {
      ticker: pos.ticker,
      name: pos.name,
      sector: pos.sector || 'Other',
      pct: data[idx].pct,
      priceFormatted: symbol + (pos.currentPrice * rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      valueFormatted: symbol + Math.round(rawVal * rate).toLocaleString(),
      shares: pos.totalShares,
      avgCostFormatted: symbol + (pos.averageCost * rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      purchaseValueFormatted: symbol + Math.round(pos.totalShares * pos.averageCost * rate).toLocaleString()
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
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);
    
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
    const savedView = localStorage.getItem('pt_dash_active_view');
    if (savedView) {
      this.activeView.set(savedView as any);
    }
    const savedPeriod = localStorage.getItem('pt_dash_history_period');
    if (savedPeriod) {
      this.historyPeriod.set(savedPeriod as any);
    }

    effect(() => {
      localStorage.setItem('pt_dash_active_view', this.activeView());
    });
    effect(() => {
      localStorage.setItem('pt_dash_history_period', this.historyPeriod());
    });

    const timeStr = localStorage.getItem('pt_last_refresh_time');
    if (timeStr) {
      const parsedTime = parseInt(timeStr, 10);
      this.service.lastRefreshTime.set(parsedTime);
      if (Date.now() - parsedTime > 180000) {
        this.refreshMarketDataSilently();
      }
    } else {
      this.refreshMarketDataSilently();
    }

    // Fetch historical prices only when period, transactions, date filters, or view changes
    effect(() => {
      this.historyPeriod();
      this.service.activeTransactions();
      this.activeView();
      this.service.dateFrom();
      this.service.dateTo();
      this.service.disabledSources();
      untracked(() => {
        this.loadHistoryForChart();
      });
    });

    // Redraw charts when data changes, display currency toggles, or when historicalPrices cache resolves
    effect(() => {
      const assetData = this.assetChartData();
      const sectorData = this.sectorChartData();
      
      this.service.dateFrom(); // Re-draw when date filter changes
      this.service.dateTo();
      this.historyPeriod(); // Register dependency
      this.service.historicalPrices(); // Redraw chart when cache updates
      this.service.disabledSources();
      this.service.theme(); // Redraw on theme change
      this.isChartsCollapsed(); // Redraw when expanded
      
      // Wait a tick for DOM updates
      setTimeout(() => {
        this.drawCharts(assetData, sectorData);
        this.updateHistoryChartData();
      }, 50);
    });
    // Auto-fill All Time dates when transactions load for first time
    effect(() => {
      const txs = this.service.transactions();
      untracked(() => {
        const from = this.service.dateFrom();
        const to = this.service.dateTo();
        if (!from && !to && txs.length > 0) {
          this.clearDateFilter();
        }
      });
    });

    document.addEventListener('visibilitychange', this.handleVisibilityChangeBind);
    this.startAutoRefreshInterval();

    this.timeAgoIntervalId = setInterval(() => {
      this.cdr.detectChanges();
    }, 15000);

    ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, this.onUserActivity, { passive: true });
    });
  }

  ngOnDestroy() {
    this.stopAutoRefreshInterval();
    if (this.timeAgoIntervalId) {
      clearInterval(this.timeAgoIntervalId);
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChangeBind);
    ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
      document.removeEventListener(event, this.onUserActivity);
    });
  }

  ngAfterViewInit() {
    this.drawCharts(this.assetChartData(), this.sectorChartData());
    this.updateHistoryChartData();
    this.setupChartEvents();
  }

  public setHistoryPeriod(period: any) {
    this.historyPeriod.set(period);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    
    let fromDate = new Date();
    if (period === '1w') fromDate.setDate(today.getDate() - 7);
    else if (period === '1m') fromDate.setDate(today.getDate() - 30);
    else if (period === '3m') fromDate.setDate(today.getDate() - 90);
    else if (period === '6m') fromDate.setDate(today.getDate() - 180);
    else if (period === '1y') fromDate.setDate(today.getDate() - 365);
    else {
      this.clearDateFilter();
      return;
    }
    
    this.service.dateFrom.set(fromDate.toISOString().slice(0, 10));
    this.service.dateTo.set(todayStr);
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
        const x = (event.clientX - rect.left) * (canvas.width / rect.width);
        const y = (event.clientY - rect.top) * (canvas.height / rect.height);
        
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
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

  public getCurrencySymbol(curr: string): string {
    return this.service.getCurrencySymbol(curr);
  }

  public getCurrencyBtnLabel(curr: string): string {
    return this.service.getCurrencyBtnLabel(curr);
  }

  public getCurrencyTooltip(curr: string): string {
    const c = curr.toUpperCase();
    if (c === 'EUR') {
      return 'EUR - Uses calendar year average exchange rate tax rule.';
    }
    return `${c} - Uses daily exchange rate on transaction date.`;
  }

  public getLocaleForCurrency(curr: string): string {
    const locales: any = {
      'INR': 'en-IN',
      'EUR': 'en-IE',
      'USD': 'en-US',
      'GBP': 'en-GB',
      'CHF': 'de-CH',
      'CAD': 'en-CA',
      'AUD': 'en-AU',
      'JPY': 'ja-JP'
    };
    return locales[curr] || 'en-US';
  }

  public formatVal(val: number, fromCurrency: string = 'USD', decimals: number = 2, nativeCurrency?: string, forceSign: boolean = false): string {
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native'
      ? (nativeCurrency || this.service.defaultCurrency())
      : displayCurr;
    const rate = this.service.getExchangeRate(fromCurrency, targetCurr);
    const converted = val * rate;
    const symbol = this.getCurrencySymbol(targetCurr);
    
    const isNegative = converted < 0;
    const absVal = Math.abs(converted);
    const locale = this.getLocaleForCurrency(targetCurr);
    const formatted = absVal.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    
    if (forceSign) {
      const arrow = isNegative ? '▼ ' : '▲ ';
      return arrow + symbol + formatted;
    }
    
    const sign = isNegative ? '-' : '';
    return sign + symbol + formatted;
  }

  public getAbs(val: number): number {
    return Math.abs(val);
  }

  public getRowFxRate(fromCurrency: string, date?: string): number {
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? fromCurrency : displayCurr;
    return this.service.getExchangeRate(fromCurrency, targetCurr, date);
  }

  public formatValShort(val: number, fromCurrency: string = 'USD'): string {
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate(fromCurrency, targetCurr);
    const converted = val * rate;
    const symbol = this.getCurrencySymbol(targetCurr);
    
    const isNegative = converted < 0;
    const absVal = Math.abs(converted);
    const locale = this.getLocaleForCurrency(targetCurr);
    const formatted = Math.round(absVal).toLocaleString(locale);
    return (isNegative ? '-' : '') + symbol + formatted;
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
          
          const combinedRealizedCost = parseFloat(((existing.realizedCost || 0) + (pos.realizedCost || 0)).toFixed(2));
          existing.realizedCost = combinedRealizedCost;

          existing.unrealizedReturnPct = existing.totalCost > 0 ? parseFloat(((existing.unrealizedProfit / existing.totalCost) * 100).toFixed(2)) : 0;
          existing.realizedReturnPct = combinedRealizedCost > 0 ? parseFloat(((existing.realizedProfit / combinedRealizedCost) * 100).toFixed(2)) : 0;
          existing.totalReturnPct = (existing.totalCost + combinedRealizedCost) > 0 ? parseFloat(((existing.totalReturn / (existing.totalCost + combinedRealizedCost)) * 100).toFixed(2)) : 0;
        }
      });
    };

    addPositionsFromSummary(summaryA);
    addPositionsFromSummary(summaryB);

    const positions = Array.from(positionsMap.values()).filter(p => p.totalShares > 0.0001);
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
      totalFees: parseFloat((summaryA.totalFees + summaryB.totalFees).toFixed(2)),
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
    const displayWidth = Math.min(460, canvas.parentElement?.clientWidth || 460);
    const displayHeight = displayWidth < 380 ? 260 : 320;

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
        const isLight = this.service.theme() === 'light';
        ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.2)' : 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw label text next to line end
        ctx.fillStyle = isLight ? '#475569' : '#9ca3af';
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
        ctx.strokeStyle = isLight ? '#f1f5f9' : '#080c14'; // match page bg
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      startAngle = endAngle;
    });

    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const symbol = this.getCurrencySymbol(targetCurr);
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const isLightMode = this.service.theme() === 'light';

    // Draw center label (always clean and static)
    ctx.fillStyle = isLightMode ? '#0f172a' : '#f3f4f6';
    ctx.font = '600 17px Outfit';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(centerText, cx, cy - 10);

    ctx.fillStyle = isLightMode ? '#475569' : '#9ca3af';
    ctx.font = '400 12px Outfit';
    
    let totalVal = data.reduce((sum, item) => sum + item.value, 0);
    const convertedTotal = totalVal * rate;
    ctx.fillText(symbol + Math.round(convertedTotal).toLocaleString(), cx, cy + 12);
  }

  public trackByPosition(index: number, item: any): string {
    return item.ticker;
  }

  public trackByRealizedGroup(index: number, item: any): string {
    return item.ticker;
  }

  public trackByRealizedSale(index: number, item: any): string {
    return item.id;
  }

  private loadHistoryTimeout: any = null;

  private loadHistoryForChart() {
    this.chartLoadSession++;
    const currentSession = this.chartLoadSession;

    if (this.loadHistoryTimeout) {
      clearTimeout(this.loadHistoryTimeout);
    }
    this.loadHistoryTimeout = setTimeout(async () => {
      this.loadHistoryTimeout = null;

      const period = this.historyPeriod();
      const dateFrom = this.service.dateFrom();
      const dateTo = this.service.dateTo();

      let range = '1mo';
      
      // Determine target range start date based on the active top filter (capped at today)
      let endDate = new Date();
      if (dateTo) {
        const parsedTo = new Date(dateTo);
        if (parsedTo < endDate) {
          endDate = parsedTo;
        }
      }
      
      let startDate = new Date(endDate);
      
      if (period === '1w') startDate.setDate(startDate.getDate() - 7);
      else if (period === '1m') startDate.setDate(startDate.getDate() - 30);
      else if (period === '3m') startDate.setDate(startDate.getDate() - 90);
      else if (period === '6m') startDate.setDate(startDate.getDate() - 180);
      else if (period === '1y') startDate.setDate(startDate.getDate() - 365);
      else {
        // 'all'
        if (dateFrom) {
          startDate = new Date(dateFrom);
        } else {
          const txs = this.service.transactions();
          if (txs.length > 0) {
            startDate = new Date(txs[0].date);
          }
        }
      }
      
      // Days diff between today and target start date determines Yahoo API history range
      const daysDiff = (new Date().getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff <= 30) range = '1mo';
      else if (daysDiff <= 90) range = '3mo';
      else if (daysDiff <= 180) range = '6mo';
      else if (daysDiff <= 365) range = '1y';
      else if (daysDiff <= 730) range = '2y';
      else if (daysDiff <= 1825) range = '5y';
      else range = 'max';

      const txs = this.service.activeTransactions()
        .filter(t => t.type.toUpperCase() === 'BUY' || t.type.toUpperCase() === 'SELL')
        .filter(t => !this.service.disabledSources().includes(t.source || ''));
      const tickers = Array.from(new Set(txs.map(t => t.ticker.toUpperCase().trim()).filter(Boolean)));
      tickers.push('USDINR=X');
      tickers.push('USDEUR=X');
      if (tickers.length > 0) {
        await this.service.fetchHistoricalPricesForTickers(tickers, range);
      }

      if (currentSession === this.chartLoadSession) {
        this.updateHistoryChartData();
      }
    }, 200);
  }

  public calculateHistoricalData(): any[] {
    const cache = this.service.historicalPrices();
    const activeView = this.activeView();
    const filterTkr = this.filterTicker().toUpperCase().trim();
    let txs = [...this.service.activeTransactions()];
    txs = txs.filter(t => t.type.toUpperCase() === 'BUY' || t.type.toUpperCase() === 'SELL');
    txs = txs.filter(t => !this.service.disabledSources().includes(t.source || ''));
    if (filterTkr) {
      txs = txs.filter(t => (t.ticker || '').toUpperCase().trim() === filterTkr);
    }

    if (activeView === 'ownerA') {
      txs = txs.filter(t => t.personAShares > 0);
    } else if (activeView === 'ownerB') {
      txs = txs.filter(t => t.personBShares > 0);
    }

    txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (txs.length === 0) return [];

    const configs = this.service.tickerConfigs();

    // Determine start/end of the chart period
    const dateFrom = this.service.dateFrom();
    const dateTo = this.service.dateTo();

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    let endDate = new Date(today);
    if (dateTo && !this.isAllTimeActive()) {
      const parsedTo = new Date(dateTo);
      if (parsedTo < today) {
        endDate = parsedTo;
      }
    }
    endDate.setHours(23, 59, 59, 999);

    const period = this.historyPeriod();
    let startDate = new Date(endDate); // Offset from the active year end date

    if (period === '1w') startDate.setDate(endDate.getDate() - 7);
    else if (period === '1m') startDate.setDate(endDate.getDate() - 30);
    else if (period === '3m') startDate.setDate(endDate.getDate() - 90);
    else if (period === '6m') startDate.setDate(endDate.getDate() - 180);
    else if (period === '1y') startDate.setDate(endDate.getDate() - 365);
    else {
      // 'all'
      if (dateFrom) {
        startDate = new Date(dateFrom);
      } else {
        startDate = new Date(txs[0].date);
      }
    }
    startDate.setHours(0, 0, 0, 0);

    const getLocalDateStr = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const todayStr = getLocalDateStr(new Date());

    // Generate target dates to calculate and plot (optimizing points for longer ranges)
    const targetDates: Date[] = [];
    let step = 1;
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (period === '3m') step = 2;
    else if (period === '6m') step = 4;
    else if (period === '1y') step = 7;
    else if (period === 'all') {
      if (totalDays > 365) {
        step = Math.ceil(totalDays / 60); // approx 60 points max
      } else {
        step = 2;
      }
    }

    // Always start with startDate
    targetDates.push(new Date(startDate));

    let temp = new Date(startDate);
    while (true) {
      temp.setDate(temp.getDate() + step);
      if (temp >= endDate) {
        break;
      }
      targetDates.push(new Date(temp));
    }

    // Always end with endDate
    targetDates.push(new Date(endDate));

    // Ensure unique date strings
    const uniqueDates: Date[] = [];
    const seenDateStrings = new Set<string>();
    targetDates.forEach(d => {
      const s = getLocalDateStr(d);
      if (!seenDateStrings.has(s)) {
        seenDateStrings.add(s);
        uniqueDates.push(d);
      }
    });

    const sharesMap = new Map<string, number>();
    const posCostMap = new Map<string, number>();
    const lastTxPriceMap = new Map<string, number>();
    
    let txIdx = 0;
    const allPoints: any[] = [];

    // Single linear pass over target dates and transactions
    for (const targetDate of uniqueDates) {
      const curDateStr = getLocalDateStr(targetDate);

      // Apply all transactions that occurred on or before curDateStr
      while (txIdx < txs.length && (txs[txIdx].date || '').slice(0, 10) <= curDateStr) {
        const tx = txs[txIdx];
        const ticker = (tx.ticker || '').toUpperCase().trim();
        const type = tx.type.toUpperCase();

        const rateToUsd = tx.currency.toUpperCase() === 'USD'
          ? 1.0
          : (tx.fxRate && tx.fxRate !== 1.0 ? tx.fxRate : this.service.getExchangeRate(tx.currency, 'USD'));

        let actualShares = 0;
        let actualCostBasis = 0;

        if (activeView === 'ownerA') {
          actualShares = tx.personAShares;
          actualCostBasis = tx.personACostBasis * rateToUsd;
        } else if (activeView === 'ownerB') {
          actualShares = tx.personBShares;
          actualCostBasis = tx.personBCostBasis * rateToUsd;
        } else {
          actualShares = (tx.personAShares || 0) + (tx.personBShares || 0);
          actualCostBasis = ((tx.personACostBasis || 0) + (tx.personBCostBasis || 0)) * rateToUsd;
        }

        const cfg = configs[ticker];
        if (cfg && cfg.splitRatio && cfg.splitDate && tx.date && tx.date.slice(0, 10) < cfg.splitDate) {
          actualShares *= cfg.splitRatio;
        }

        if (type === 'BUY') {
          if (ticker) {
            sharesMap.set(ticker, (sharesMap.get(ticker) || 0) + actualShares);
            posCostMap.set(ticker, (posCostMap.get(ticker) || 0) + actualCostBasis);
            lastTxPriceMap.set(ticker, (tx.price || 0) * rateToUsd);
          }
        } else if (type === 'SELL') {
          if (ticker) {
            const currentShares = sharesMap.get(ticker) || 0;
            const currentCost = posCostMap.get(ticker) || 0;
            const avgCost = currentShares > 0 ? (currentCost / currentShares) : 0;
            const costOfSharesSold = actualShares * avgCost;

            sharesMap.set(ticker, Math.max(0, currentShares - actualShares));
            posCostMap.set(ticker, Math.max(0, currentCost - costOfSharesSold));
            lastTxPriceMap.set(ticker, (tx.price || 0) * rateToUsd);
          }
        }
        txIdx++;
      }

      // Compute value and cost basis for targetDate
      let dailyCostBasisUsd = 0;
      posCostMap.forEach((c) => {
        dailyCostBasisUsd += c;
      });

      let dailyValuationUsd = 0;

      sharesMap.forEach((shares, tkr) => {
        if (shares <= 0) return;

        const isToday = curDateStr === todayStr;
        let priceNative = null;

        if (!isToday) {
          const tickerCache = cache[tkr];
          if (tickerCache) {
            if (tickerCache[curDateStr] !== undefined) {
              priceNative = tickerCache[curDateStr];
            } else {
              const cacheDates = Object.keys(tickerCache).filter(d => d <= curDateStr).sort();
              if (cacheDates.length > 0) {
                priceNative = tickerCache[cacheDates[cacheDates.length - 1]];
              }
            }
          }
        }

        let priceUsd = 0;
        if (priceNative !== null) {
          const cfg = configs[tkr];
          const priceCurr = cfg?.priceCurrency || 'USD';
          const priceRate = this.service.getExchangeRate(priceCurr, 'USD');
          priceUsd = priceNative * priceRate;
        } else {
          priceUsd = lastTxPriceMap.get(tkr) || 0;
          if (priceUsd === 0 || isToday) {
            const cfg = configs[tkr];
            if (cfg) {
              const priceCurr = cfg.priceCurrency || 'USD';
              const priceRate = this.service.getExchangeRate(priceCurr, 'USD');
              priceUsd = cfg.currentPrice * priceRate;
            }
          }
        }

        dailyValuationUsd += shares * priceUsd;
      });

      allPoints.push({
        date: new Date(targetDate),
        invested: dailyCostBasisUsd,
        value: dailyValuationUsd,
        shares: sharesMap.get(filterTkr) || 0,
        avgCost: (sharesMap.get(filterTkr) || 0) > 0 ? (posCostMap.get(filterTkr) || 0) / (sharesMap.get(filterTkr) || 0) : 0
      });
    }

    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rateToTarget = this.service.getExchangeRate('USD', targetCurr);

    const finalPoints = allPoints.map(p => ({
      date: p.date,
      invested: parseFloat((p.invested * rateToTarget).toFixed(2)),
      value: parseFloat((p.value * rateToTarget).toFixed(2)),
      shares: p.shares,
      avgCost: parseFloat((p.avgCost * rateToTarget).toFixed(4))
    }));

    return finalPoints;
  }

  public updateHistoryChartData() {
    const points = this.calculateHistoricalData();
    this.gradientCounter++;
    this.gradientId = `chartLineGrad_${this.gradientCounter}`;
    if (points.length === 0) {
      this.chartPoints = [];
      this.investedPath = '';
      this.valuePath = '';
      this.fillPath = '';
      this.yTicks = [];
      this.xTicks = [];
      this.cdr.detectChanges();
      return;
    }

    let minVal = Infinity;
    let maxVal = -Infinity;
    points.forEach(p => {
      minVal = Math.min(minVal, p.invested, p.value);
      maxVal = Math.max(maxVal, p.invested, p.value);
    });

    if (minVal === Infinity || maxVal === -Infinity) {
      minVal = 0;
      maxVal = 100;
    } else {
      const diff = maxVal - minVal;
      if (diff === 0) {
        minVal = Math.max(0, minVal * 0.9);
        maxVal = maxVal * 1.1;
      } else {
        minVal = Math.max(0, minVal - diff * 0.1);
        maxVal = maxVal + diff * 0.15;
      }
    }

    this.chartMinVal = minVal;
    this.chartMaxVal = maxVal;

    const minTime = points[0].date.getTime();
    const maxTime = points[points.length - 1].date.getTime();
    const timeSpan = maxTime - minTime || 1;

    const paddingLeft = 0;
    const paddingRight = 0;
    const paddingTop = 30;
    const paddingBottom = 40;
    const chartWidth = 1000 - paddingLeft - paddingRight;
    const chartHeight = 320 - paddingTop - paddingBottom;

    const getX = (t: number) => paddingLeft + ((t - minTime) / timeSpan) * chartWidth;
    const getY = (v: number) => {
      const denom = maxVal - minVal;
      if (denom === 0) return paddingTop + chartHeight;
      return paddingTop + chartHeight - ((v - minVal) / denom) * chartHeight;
    };

    this.chartPoints = points.map(p => {
      const x = getX(p.date.getTime());
      const yInv = getY(p.invested);
      const yVal = getY(p.value);
      const dateStr = this.datePipe.transform(p.date, this.service.dateFormat()) || '';
      return {
        date: p.date,
        dateStr,
        invested: p.invested,
        value: p.value,
        shares: p.shares,
        avgCost: p.avgCost,
        x,
        yInv,
        yVal
      };
    });

    const getBezierPath = (pts: { x: number; y: number }[]): string => {
      if (pts.length === 0) return '';
      let d = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const cp1x = prev.x + (curr.x - prev.x) / 2;
        const cp1y = prev.y;
        const cp2x = prev.x + (curr.x - prev.x) / 2;
        const cp2y = curr.y;
        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
      }
      return d;
    };

    const valPoints = this.chartPoints.map(p => ({ x: p.x, y: p.yVal }));
    const invPoints = this.chartPoints.map(p => ({ x: p.x, y: p.yInv }));

    this.valuePath = getBezierPath(valPoints);
    this.investedPath = getBezierPath(invPoints);

    if (this.chartPoints.length > 0) {
      const first = this.chartPoints[0];
      const last = this.chartPoints[this.chartPoints.length - 1];
      const bottomY = paddingTop + chartHeight;
      this.fillPath = `M ${first.x} ${bottomY} L ${first.x} ${first.yVal}` +
        this.valuePath.substring(1) +
        ` L ${last.x} ${bottomY} Z`;
    } else {
      this.fillPath = '';
    }

    const lastPt = points[points.length - 1];
    const isOverallProfit = lastPt.value >= lastPt.invested;
    this.svgThemeColor = isOverallProfit ? '#10b981' : '#ef4444';
    this.svgFillGradStr = isOverallProfit ? '16, 185, 129' : '239, 68, 68';

    this.lineGradStops = [];
    if (this.chartPoints.length > 0) {
      const minX = this.chartPoints[0].x;
      const maxX = this.chartPoints[this.chartPoints.length - 1].x;
      const totalWidth = maxX - minX || 1;

      this.chartPoints.forEach((p) => {
        const pct = ((p.x - minX) / totalWidth) * 100;
        const isProfit = p.value >= p.invested;
        const color = isProfit ? '#10b981' : '#ef4444';
        
        this.lineGradStops.push({
          offset: `${pct}%`,
          color: color
        });
      });
    }

    const yTicksCount = 5;
    this.yTicks = [];
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const symbol = this.getCurrencySymbol(targetCurr);

    for (let i = 0; i <= yTicksCount; i++) {
      const val = minVal + (maxVal - minVal) * (i / yTicksCount);
      const y = getY(val);
      let valText = symbol + Math.round(val).toLocaleString();
      if (val >= 1000000) {
        valText = symbol + (val / 1000000).toFixed(1) + 'M';
      } else if (val >= 1000) {
        valText = symbol + (val / 1000).toFixed(1) + 'k';
      }
      this.yTicks.push({ valText, y });
    }

    const xTicksCount = 5;
    this.xTicks = [];
    for (let i = 0; i < xTicksCount; i++) {
      const targetTime = minTime + (maxTime - minTime) * (i / (xTicksCount - 1));
      const tickDate = new Date(targetTime);
      const x = getX(targetTime);
      const dateStr = this.datePipe.transform(tickDate, 'MMM d, yyyy') || '';
      this.xTicks.push({ dateStr, x });
    }
    this.cdr.detectChanges();
  }

  private startAutoRefreshInterval() {
    this.stopAutoRefreshInterval();
    // Auto-refresh every 3 minutes (180,000 ms) while visible (avoids rate limits/getting banned)
    this.activeIntervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.refreshMarketDataSilently();
      }
    }, 180000);
  }

  private stopAutoRefreshInterval() {
    if (this.activeIntervalId) {
      clearInterval(this.activeIntervalId);
      this.activeIntervalId = null;
    }
  }

  private handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      const last = this.service.lastRefreshTime() || 0;
      const now = Date.now();
      // If last refresh was > 5 minutes (300,000 ms) ago, sync prices on tab return
      if (now - last > 300000) {
        this.refreshMarketDataSilently();
      }
      this.startAutoRefreshInterval();
    } else {
      this.stopAutoRefreshInterval();
    }
  }

  private async refreshMarketDataSilently() {
    // Skip if user has been inactive for > 3 minutes (180,000 ms)
    if (Date.now() - this.lastActivityTime > 180000) {
      return;
    }

    // Skip refreshing if there are no movements/positions to sync
    if (this.filteredPositions().length === 0) {
      return;
    }

    await this.service.refreshMarketData(false);
  }

  public getSyncedTimeAgoText(): string {
    return this.service.getSyncedTimeAgoText();
  }
}
