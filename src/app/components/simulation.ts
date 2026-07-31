import { Component, inject, signal, computed, effect, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioService } from '../services/portfolio.service';
import { SimulatedTransaction } from '../models/simulated-transaction.model';
import { PersonPortfolioSummary } from '../models/portfolio-summary.model';
import { PortfolioPosition } from '../models/portfolio-position.model';

@Component({
  selector: 'app-simulation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './simulation.html',
  styleUrl: './simulation.css'
})
export class SimulationComponent implements AfterViewInit {
  public service = inject(PortfolioService);

  // Form states
  public type = signal<'BUY' | 'SELL'>('BUY');
  public account = signal<'A' | 'B'>('A');
  public ticker = signal<string>('');
  public shares = signal<number | null>(null);
  public price = signal<number | null>(null);
  public feesType = signal<'none' | 'bps' | 'custom'>('none');
  public feesVal = signal<number | null>(null);
  public editingId = signal<string | null>(null);

  @ViewChild('assetCanvas') assetCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sectorCanvas') sectorCanvas!: ElementRef<HTMLCanvasElement>;

  // Hover states for allocation charts
  public hoveredAssetIndex = signal<number>(-1);
  public hoveredSectorIndex = signal<number>(-1);
  public isChartsCollapsed = signal<boolean>(false);

  constructor() {
    // Automatically update price when ticker is entered
    effect(() => {
      const t = this.ticker().toUpperCase().trim();
      if (t) {
        const livePrice = this.service.getTickerCurrentPrice(t);
        if (livePrice > 0 && !this.editingId()) {
          this.price.set(livePrice);
        }
      }
    });

    // Reactive effect to redraw charts on data change
    effect(() => {
      // Access reactive dependencies
      this.simulatedSummary();
      this.allocationBasis();
      this.hoveredAssetIndex();
      this.hoveredSectorIndex();
      this.service.useProperSectors();
      this.service.theme();
      this.isChartsCollapsed();
      
      // Delay slightly to ensure canvas is rendered
      setTimeout(() => this.drawCharts(), 0);
    });
  }

  ngAfterViewInit() {
    this.drawCharts();
    this.setupChartEvents();
  }

  public allocationBasis = signal<'value' | 'cost'>('value');

  // Calculate real summary (combined)
  public realSummary = computed(() => {
    const txs = this.service.transactions();
    const sumA = this.service.calculatePortfolioForOwner('A', txs);
    const sumB = this.service.calculatePortfolioForOwner('B', txs);
    return this.combineSummaries(sumA, sumB);
  });

  // Calculate simulated summary (combined)
  public simulatedSummary = computed(() => {
    const txs = this.service.effectiveTransactions();
    const sumA = this.service.calculatePortfolioForOwner('A', txs);
    const sumB = this.service.calculatePortfolioForOwner('B', txs);
    return this.combineSummaries(sumA, sumB);
  });

  // Simulated holdings for the selected account, excluding the one currently being edited (if editing)
  public currentAccountSummaryExcludingEdit = computed(() => {
    const owner = this.account();
    const editId = this.editingId();
    
    // Get real transactions
    const real = this.service.transactions();
    
    // Get simulated transactions, excluding the one being edited
    const sims = this.service.simulatedTransactions().filter(s => !editId || s.id !== editId);
    
    // Convert sims to Transaction objects
    const convertedSims = sims.map(s => {
      const fees = this.service.calculateSimulatedFees(s);
      const totalAmount = s.type === 'BUY'
        ? (s.shares * s.price + fees)
        : (s.shares * s.price - fees);
      
      const quantity = s.shares;
      let personAShares = 0;
      let personBShares = 0;
      let personACostBasis = 0;
      let personBCostBasis = 0;

      if (s.account === 'A') {
        personAShares = s.shares;
        personACostBasis = totalAmount;
      } else {
        personBShares = s.shares;
        personBCostBasis = totalAmount;
      }

      const tickerUpper = s.ticker.toUpperCase().trim();
      const tickerCurrency = this.service.tickerConfigs()[tickerUpper]?.priceCurrency || 'USD';

      return {
        id: 'sim-' + s.id,
        date: new Date().toISOString().slice(0, 10),
        ticker: tickerUpper,
        type: s.type,
        price: s.price,
        quantity: quantity,
        totalAmount: totalAmount,
        currency: tickerCurrency,
        personAShares,
        personBShares,
        personACostBasis,
        personBCostBasis,
        source: 'Simulation',
        _isSimulated: true
      } as any;
    });

    const allTxs = [...real, ...convertedSims];
    return this.service.calculatePortfolioForOwner(owner, allTxs);
  });

  public availableTickersForSell = computed(() => {
    const s = this.currentAccountSummaryExcludingEdit();
    return s.positions.filter(p => p.totalShares > 0.0001).map(p => p.ticker.toUpperCase());
  });

  public maxSharesForSell = computed(() => {
    if (this.type() !== 'SELL') return null;
    const t = this.ticker().toUpperCase().trim();
    if (!t) return 0;
    const pos = this.currentAccountSummaryExcludingEdit().positions.find(p => p.ticker.toUpperCase() === t);
    return pos ? pos.totalShares : 0;
  });

  // Calculate net cash impact grouped by currency
  public cashImpact = computed(() => {
    const sims = this.service.simulatedTransactions();
    const map = {} as Record<string, number>;
    sims.forEach(s => {
      const fees = this.service.calculateSimulatedFees(s);
      const subtotal = s.shares * s.price;
      const net = s.type === 'BUY' ? - (subtotal + fees) : (subtotal - fees);
      const curr = this.service.getTickerCurrency(s.ticker);
      map[curr] = (map[curr] || 0) + net;
    });
    return Object.entries(map).map(([currency, amount]) => ({ currency, amount }));
  });

  // Pre-fill price from live rate helper
  public useLivePrice() {
    const t = this.ticker().toUpperCase().trim();
    if (t) {
      const livePrice = this.service.getTickerCurrentPrice(t);
      if (livePrice > 0) {
        this.price.set(livePrice);
      }
    }
  }

  // Get active currency code for the current input ticker
  public getActiveCurrencyCode(): string {
    const t = this.ticker().toUpperCase().trim();
    if (!t) return 'USD';
    return this.service.getTickerCurrency(t);
  }

  public addVisibleCurrency(code: string) {
    const upper = code.toUpperCase().trim();
    if (upper && !this.service.visibleCurrencies().includes(upper)) {
      this.service.visibleCurrencies.update(list => [...list, upper]);
      this.service.saveToStorage();
    }
  }

  // Form submission handler
  public saveSimulation() {
    const t = this.ticker().toUpperCase().trim();
    const sh = this.shares();
    const pr = this.price();
    if (!t || !sh || sh <= 0 || !pr || pr <= 0) return;

    if (this.type() === 'SELL') {
      const ownedTickers = this.availableTickersForSell();
      if (!ownedTickers.includes(t)) {
        this.service.showToast(`Error: Selected account does not own ticker ${t}`, 'error');
        return;
      }
      const maxSh = this.maxSharesForSell();
      if (maxSh !== null && sh > maxSh + 0.000001) {
        this.service.showToast(`Error: Cannot sell more than owned (${maxSh.toFixed(6)} shares)`, 'error');
        return;
      }
    }

    // Ensure ticker configuration exists so logo and currency load correctly
    const configs = { ...this.service.tickerConfigs() };
    if (!configs[t]) {
      configs[t] = {
        ticker: t,
        name: t,
        priceCurrency: 'USD',
        currentPrice: pr,
        sector: 'Other',
        notFound: false
      };
      this.service.tickerConfigs.set(configs);
      this.service.saveToStorage();
    }

    const newSim: SimulatedTransaction = {
      id: this.editingId() || Math.random().toString(36).substring(2, 9),
      type: this.type(),
      account: this.account(),
      ticker: t,
      shares: sh,
      price: pr,
      feesType: this.feesType(),
      feesVal: this.feesVal() || 0
    };

    if (this.editingId()) {
      // Update
      this.service.simulatedTransactions.update(list => 
        list.map(x => x.id === this.editingId() ? newSim : x)
      );
      this.editingId.set(null);
    } else {
      // Add
      this.service.simulatedTransactions.update(list => [...list, newSim]);
    }

    this.service.saveToStorage();
    this.resetForm();
  }

  public editSimulation(sim: SimulatedTransaction) {
    this.editingId.set(sim.id);
    this.type.set(sim.type);
    this.account.set(sim.account);
    this.ticker.set(sim.ticker);
    this.shares.set(sim.shares);
    this.price.set(sim.price);
    this.feesType.set(sim.feesType);
    this.feesVal.set(sim.feesVal);
  }

  public deleteSimulation(id: string) {
    this.service.simulatedTransactions.update(list => list.filter(x => x.id !== id));
    this.service.saveToStorage();
    if (this.editingId() === id) {
      this.resetForm();
    }
  }

  public clearAllSimulations() {
    this.service.simulatedTransactions.set([]);
    this.service.saveToStorage();
    this.resetForm();
  }

  public resetForm() {
    this.editingId.set(null);
    this.ticker.set('');
    this.shares.set(null);
    this.price.set(null);
    this.feesType.set('none');
    this.feesVal.set(null);
  }

  public getSimulationProfitDetail(sim: SimulatedTransaction) {
    const displayCurr = this.service.displayCurrency();
    const tickerCurr = this.service.getTickerCurrency(sim.ticker);
    const targetCurr = displayCurr === 'native' ? tickerCurr : displayCurr;
    const rate = this.service.getExchangeRate(tickerCurr, targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);

    const configs = this.service.tickerConfigs();
    const currentPriceUSD = configs[sim.ticker]?.currentPrice || sim.price;
    const simPriceUSD = sim.price;
    const shares = sim.shares;
    const feesUSD = this.service.calculateSimulatedFees(sim);

    let simCostUSD = 0;
    let todayValUSD = 0;
    let profitUSD = 0;

    if (sim.type === 'BUY') {
      simCostUSD = (shares * simPriceUSD) + feesUSD;
      todayValUSD = shares * currentPriceUSD;
      profitUSD = todayValUSD - simCostUSD;
    } else {
      simCostUSD = (shares * simPriceUSD) - feesUSD;
      todayValUSD = shares * currentPriceUSD;
      profitUSD = simCostUSD - todayValUSD;
    }

    const profitPct = simCostUSD > 0 ? (profitUSD / simCostUSD) * 100 : 0;
    const isGain = profitUSD >= 0;

    return {
      todayPriceFormatted: symbol + (currentPriceUSD * rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      simCostUSD,
      todayValUSD,
      profitUSD,
      profitPct,
      isGain,
      profitFormatted: (isGain ? '+' : '-') + symbol + Math.abs(profitUSD * rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      profitPctFormatted: (isGain ? '+' : '-') + Math.abs(profitPct).toFixed(1) + '%'
    };
  }

  public simulatedProfitSummary = computed(() => {
    const sims = this.service.simulatedTransactions();
    if (sims.length === 0) return null;

    let totalSimCostUSD = 0;
    let totalTodayValUSD = 0;

    sims.forEach(sim => {
      const d = this.getSimulationProfitDetail(sim);
      totalSimCostUSD += d.simCostUSD;
      totalTodayValUSD += d.todayValUSD;
    });

    const totalProfitUSD = totalTodayValUSD - totalSimCostUSD;
    const totalProfitPct = totalSimCostUSD > 0 ? (totalProfitUSD / totalSimCostUSD) * 100 : 0;
    const isGain = totalProfitUSD >= 0;

    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);

    return {
      totalSimCostFormatted: symbol + Math.round(totalSimCostUSD * rate).toLocaleString(),
      totalTodayValFormatted: symbol + Math.round(totalTodayValUSD * rate).toLocaleString(),
      totalProfitFormatted: (isGain ? '+' : '-') + symbol + Math.abs(totalProfitUSD * rate).toLocaleString(),
      totalProfitPctFormatted: (isGain ? '+' : '-') + Math.abs(totalProfitPct).toFixed(1) + '%',
      isGain
    };
  });

  // Combine positions logic (matches Dashboard Combined)
  private combineSummaries(summaryA: PersonPortfolioSummary, summaryB: PersonPortfolioSummary): PersonPortfolioSummary {
    const positionsMap = new Map<string, PortfolioPosition>();
    const addPositions = (s: PersonPortfolioSummary) => {
      s.positions.forEach(pos => {
        if (!positionsMap.has(pos.ticker)) {
          positionsMap.set(pos.ticker, { ...pos });
        } else {
          const existing = positionsMap.get(pos.ticker)!;
          const totalShares = existing.totalShares + pos.totalShares;
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

    addPositions(summaryA);
    addPositions(summaryB);

    const positions = Array.from(positionsMap.values()).filter(p => p.totalShares > 0.0001);
    positions.sort((a, b) => b.currentValue - a.currentValue);

    return {
      ownerName: 'Combined',
      positions,
      totalValue: parseFloat((summaryA.totalValue + summaryB.totalValue).toFixed(2)),
      totalCostBasis: parseFloat((summaryA.totalCostBasis + summaryB.totalCostBasis).toFixed(2)),
      totalUnrealized: parseFloat((summaryA.totalUnrealized + summaryB.totalUnrealized).toFixed(2)),
      totalRealized: parseFloat((summaryA.totalRealized + summaryB.totalRealized).toFixed(2)),
      totalReturn: parseFloat((summaryA.totalReturn + summaryB.totalReturn).toFixed(2)),
      totalDividends: parseFloat((summaryA.totalDividends + summaryB.totalDividends).toFixed(2)),
      totalFees: parseFloat(((summaryA.totalFees || 0) + (summaryB.totalFees || 0)).toFixed(2))
    };
  }

  // Pre-calculate baseline assets chart data (Before Simulation)
  public baselineAssetChartData = computed(() => {
    const s = this.realSummary();
    const isCost = this.allocationBasis() === 'cost';
    const total = isCost ? s.totalCostBasis : s.totalValue;
    if (total === 0) return [];
    
    return s.positions
      .filter(pos => (isCost ? pos.totalCost : pos.currentValue) > 0)
      .map(pos => {
        const val = isCost ? pos.totalCost : pos.currentValue;
        return {
          label: pos.ticker,
          value: val,
          pct: (val / total) * 100,
        };
      });
  });

  // Pre-calculate baseline sectors chart data (Before Simulation)
  public baselineSectorChartData = computed(() => {
    const s = this.realSummary();
    const isCost = this.allocationBasis() === 'cost';
    const total = isCost ? s.totalCostBasis : s.totalValue;
    if (total === 0) return [];
    
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);

    const sectorMap = {} as Record<string, number>;
    s.positions.forEach(pos => {
      const val = isCost ? pos.totalCost : pos.currentValue;
      if (val > 0) {
        const sec = pos.sector || 'Other';
        sectorMap[sec] = (sectorMap[sec] || 0) + val;
      }
    });

    return Object.entries(sectorMap)
      .map(([label, value]) => ({
        label,
        value,
        pct: (value / total) * 100,
        totalFormatted: symbol + Math.round(value * rate).toLocaleString()
      }))
      .sort((a, b) => b.value - a.value);
  });

  // Pre-calculate assets chart data
  public assetChartData = computed(() => {
    const s = this.simulatedSummary();
    const isCost = this.allocationBasis() === 'cost';
    const total = isCost ? s.totalCostBasis : s.totalValue;
    if (total === 0) return [];
    
    return s.positions
      .filter(pos => (isCost ? pos.totalCost : pos.currentValue) > 0)
      .map(pos => {
        const val = isCost ? pos.totalCost : pos.currentValue;
        return {
          label: pos.ticker,
          value: val,
          pct: (val / total) * 100,
        };
      });
  });

  // Pre-calculate sectors chart data with formatted totals
  public sectorChartData = computed(() => {
    const s = this.simulatedSummary();
    const isCost = this.allocationBasis() === 'cost';
    const total = isCost ? s.totalCostBasis : s.totalValue;
    if (total === 0) return [];
    
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);

    const sectorMap = {} as Record<string, number>;
    s.positions.forEach(pos => {
      const val = isCost ? pos.totalCost : pos.currentValue;
      if (val > 0) {
        const sec = pos.sector || 'Other';
        sectorMap[sec] = (sectorMap[sec] || 0) + val;
      }
    });

    return Object.entries(sectorMap)
      .map(([label, value]) => ({
        label,
        value,
        pct: (value / total) * 100,
        totalFormatted: symbol + Math.round(value * rate).toLocaleString()
      }))
      .sort((a, b) => b.value - a.value);
  });

  // Compute sector deltas (Before Simulation vs After Simulation)
  public sectorDeltas = computed(() => {
    const initialSummary = this.realSummary(); // Baseline (Before)
    const simSummary = this.simulatedSummary(); // Simulated (After)
    const isCost = this.allocationBasis() === 'cost';

    const initialTotal = isCost ? initialSummary.totalCostBasis : initialSummary.totalValue;
    const simTotal = isCost ? simSummary.totalCostBasis : simSummary.totalValue;

    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);

    const initialMap = new Map<string, number>();
    initialSummary.positions.forEach((p: PortfolioPosition) => {
      const val = isCost ? p.totalCost : p.currentValue;
      if (val > 0) {
        const sec = p.sector || 'Other';
        initialMap.set(sec, (initialMap.get(sec) || 0) + val);
      }
    });

    const simMap = new Map<string, number>();
    simSummary.positions.forEach((p: PortfolioPosition) => {
      const val = isCost ? p.totalCost : p.currentValue;
      if (val > 0) {
        const sec = p.sector || 'Other';
        simMap.set(sec, (simMap.get(sec) || 0) + val);
      }
    });

    const allSectors = Array.from(new Set([...Array.from(initialMap.keys()), ...Array.from(simMap.keys())]));
    
    return allSectors.map(sec => {
      const beforeVal = initialMap.get(sec) || 0;
      const afterVal = simMap.get(sec) || 0;
      
      const beforePct = initialTotal > 0 ? (beforeVal / initialTotal) * 100 : 0;
      const afterPct = simTotal > 0 ? (afterVal / simTotal) * 100 : 0;
      
      const deltaValUSD = afterVal - beforeVal;
      const deltaPct = afterPct - beforePct;
      
      const sign = deltaValUSD > 0 ? '+' : (deltaValUSD < 0 ? '-' : '');
      const absDeltaValUSD = Math.abs(deltaValUSD);
      const deltaValueFormatted = (deltaValUSD === 0 ? '' : sign) + symbol + Math.round(absDeltaValUSD * rate).toLocaleString();

      const pctSign = deltaPct > 0 ? '+' : (deltaPct < 0 ? '-' : '');
      const deltaPctFormatted = (deltaPct === 0 ? '0.0%' : pctSign + Math.abs(deltaPct).toFixed(1) + '%');

      return {
        label: sec,
        beforeValue: beforeVal,
        beforePct,
        beforeFormatted: symbol + Math.round(beforeVal * rate).toLocaleString(),
        afterValue: afterVal,
        afterPct,
        afterFormatted: symbol + Math.round(afterVal * rate).toLocaleString(),
        deltaValUSD,
        deltaPct,
        deltaValueFormatted,
        deltaPctFormatted
      };
    }).sort((a, b) => b.afterValue - a.afterValue);
  });

  // Compute delta info for hovered sector
  public hoveredSectorDelta = computed(() => {
    const idx = this.hoveredSectorIndex();
    const data = this.sectorChartData();
    if (idx === -1 || !data[idx]) return null;
    const sectorName = data[idx].label;
    return this.sectorDeltas().find(d => d.label === sectorName) || null;
  });

  // Compute details of the hovered asset stock with Before vs After simulation delta
  public hoveredAssetDetail = computed(() => {
    const idx = this.hoveredAssetIndex();
    const data = this.assetChartData();
    if (idx === -1 || !data[idx]) return null;
    
    const ticker = data[idx].label;
    
    const realSum = this.realSummary();
    const simSum = this.simulatedSummary();

    const realPos = realSum.positions.find(p => p.ticker === ticker);
    const simPos = simSum.positions.find(p => p.ticker === ticker);

    const isCost = this.allocationBasis() === 'cost';
    const displayCurr = this.service.displayCurrency();
    const posForCurr = simPos || realPos;
    if (!posForCurr) return null;

    const targetCurr = displayCurr === 'native' ? (posForCurr.currency || this.service.defaultCurrency()) : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const symbol = this.service.getCurrencySymbol(targetCurr);

    const realTotal = isCost ? realSum.totalCostBasis : realSum.totalValue;
    const simTotal = isCost ? simSum.totalCostBasis : simSum.totalValue;

    const beforeValUSD = realPos ? (isCost ? realPos.totalCost : realPos.currentValue) : 0;
    const afterValUSD = simPos ? (isCost ? simPos.totalCost : simPos.currentValue) : 0;

    const beforePct = realTotal > 0 ? (beforeValUSD / realTotal) * 100 : 0;
    const afterPct = simTotal > 0 ? (afterValUSD / simTotal) * 100 : 0;

    const beforeShares = realPos ? realPos.totalShares : 0;
    const afterShares = simPos ? simPos.totalShares : 0;

    const deltaValUSD = afterValUSD - beforeValUSD;
    const deltaPct = afterPct - beforePct;
    const deltaShares = afterShares - beforeShares;

    const sign = deltaValUSD > 0 ? '+' : (deltaValUSD < 0 ? '-' : '');
    const absDeltaValUSD = Math.abs(deltaValUSD);
    const deltaValueFormatted = (deltaValUSD === 0 ? '' : sign) + symbol + Math.round(absDeltaValUSD * rate).toLocaleString();

    const pctSign = deltaPct > 0 ? '+' : (deltaPct < 0 ? '-' : '');
    const deltaPctFormatted = (deltaPct === 0 ? '0.0%' : pctSign + Math.abs(deltaPct).toFixed(1) + '%');

    const sharesSign = deltaShares > 0 ? '+' : (deltaShares < 0 ? '-' : '');
    const deltaSharesFormatted = (deltaShares === 0 ? '0' : sharesSign + Math.abs(deltaShares).toLocaleString(undefined, { maximumFractionDigits: 4 }));

    const currentPrice = posForCurr.currentPrice;

    return {
      ticker: posForCurr.ticker,
      name: posForCurr.name,
      sector: posForCurr.sector || 'Other',
      priceFormatted: symbol + (currentPrice * rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      
      // Before / Baseline values
      beforeValFormatted: symbol + Math.round(beforeValUSD * rate).toLocaleString(),
      beforePct,
      beforeShares,
      
      // After / Simulated values
      afterValFormatted: symbol + Math.round(afterValUSD * rate).toLocaleString(),
      afterPct,
      afterShares,

      // Delta
      deltaValUSD,
      deltaPct,
      deltaShares,
      deltaValueFormatted,
      deltaPctFormatted,
      deltaSharesFormatted
    };
  });

  // Compute stocks belonging to the hovered sector with native currency support
  public hoveredSectorStocks = computed(() => {
    const idx = this.hoveredSectorIndex();
    const data = this.sectorChartData();
    if (idx === -1 || !data[idx]) return [];
    
    const sectorName = data[idx].label;
    const s = this.simulatedSummary();
    const displayCurr = this.service.displayCurrency();
    const isCost = this.allocationBasis() === 'cost';
    
    return s.positions
      .filter(p => (p.sector || 'Other') === sectorName && (isCost ? p.totalCost : p.currentValue) > 0)
      .map(p => {
        const valUSD = isCost ? p.totalCost : p.currentValue;
        const targetCurr = displayCurr === 'native' ? (p.currency || this.service.defaultCurrency()) : displayCurr;
        const rate = this.service.getExchangeRate('USD', targetCurr);
        const symbol = this.service.getCurrencySymbol(targetCurr);

        const returnPct = p.unrealizedReturnPct || 0;
        const isGain = (p.unrealizedProfit || 0) >= 0;

        return {
          ticker: p.ticker,
          pct: (valUSD / data[idx].value) * 100,
          valueFormatted: symbol + Math.round(p.currentValue * rate).toLocaleString(),
          costFormatted: symbol + Math.round(p.totalCost * rate).toLocaleString(),
          returnPct: Math.abs(returnPct),
          isGain: isGain
        };
      })
      .sort((a, b) => b.pct - a.pct);
  });

  public getSectorColor(index: number): string {
    return this.getColor(index + 5);
  }

  private setupChartEvents() {
    const attachHoverListener = (
      canvasRef: ElementRef<HTMLCanvasElement>,
      getData: () => { label: string; value: number; pct: number }[],
      setHoveredIndex: (idx: number) => void
    ) => {
      if (!canvasRef) return;
      const canvas = canvasRef.nativeElement;
      
      canvas.addEventListener('mousemove', (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (canvas.width / rect.width);
        const y = (event.clientY - rect.top) * (canvas.height / rect.height);
        
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const radius = Math.min(cx, cy) - 52;
        const innerRadius = radius * 0.48;
        
        const dx = x - cx;
        const dy = y - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const data = getData();
        if (distance >= innerRadius && distance <= radius && data.length > 0) {
          let angle = Math.atan2(dy, dx);
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

    setTimeout(() => {
      if (this.assetCanvas) attachHoverListener(this.assetCanvas, () => this.assetChartData(), (idx) => this.hoveredAssetIndex.set(idx));
      if (this.sectorCanvas) attachHoverListener(this.sectorCanvas, () => this.sectorChartData(), (idx) => this.hoveredSectorIndex.set(idx));
    }, 100);
  }

  // HTML5 Canvas Donut Chart rendering (Dual-Ring Ghost Pie: Inner = Baseline, Outer = Simulated)
  private drawCharts() {
    this.drawDonutChart(this.assetCanvas, this.assetChartData(), this.baselineAssetChartData(), 'Assets');
    this.drawDonutChart(this.sectorCanvas, this.sectorChartData(), this.baselineSectorChartData(), 'Sectors');
  }

  private drawDonutChart(
    canvasRef: ElementRef<HTMLCanvasElement> | undefined,
    data: { label: string; value: number; pct: number }[],
    baselineData: { label: string; value: number; pct: number }[],
    centerText: string
  ) {
    if (!canvasRef) return;
    const canvas = canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.min(460, canvas.parentElement?.clientWidth || 460);
    const displayHeight = displayWidth < 380 ? 260 : 320;

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const cx = displayWidth / 2;
    const cy = displayHeight / 2;
    const radius = Math.min(cx, cy) - (displayWidth < 400 ? 66 : 52);
    const innerRadius = radius * 0.48;

    if (data.length === 0 && baselineData.length === 0) {
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

    const hoveredIdx = centerText === 'Assets' ? this.hoveredAssetIndex() : this.hoveredSectorIndex();
    const usedYRight: number[] = [];
    const usedYLeft: number[] = [];
    const isLight = this.service.theme() === 'light';

    // 1. Draw Inner Ring: Ghost Baseline (Before Simulation Trades)
    if (baselineData.length > 0) {
      let startAngleBase = -0.5 * Math.PI;
      const innerOuterR = radius - 14;
      const innerInnerR = innerRadius - 2;
      const strokeWidthBase = innerOuterR - innerInnerR;

      baselineData.forEach((item, index) => {
        const sliceAngle = (item.pct / 100) * 2 * Math.PI;
        const endAngle = startAngleBase + sliceAngle;
        const isHovered = (index === hoveredIdx);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, (innerOuterR + innerInnerR) / 2, startAngleBase, endAngle);
        ctx.strokeStyle = this.getColor(centerText === 'Assets' ? index : index + 5);
        ctx.globalAlpha = isHovered ? 0.75 : 0.35; // Ghost opacity
        ctx.lineWidth = strokeWidthBase;
        ctx.stroke();
        ctx.restore();

        startAngleBase = endAngle;
      });
    }

    // 2. Draw Outer Ring: Active Simulated (After Simulation Trades)
    let startAngle = -0.5 * Math.PI;
    const outerR = radius;
    const outerInnerR = radius - 11;
    const strokeWidthOuter = outerR - outerInnerR;

    data.forEach((item, index) => {
      const sliceAngle = (item.pct / 100) * 2 * Math.PI;
      const endAngle = startAngle + sliceAngle;
      const isHovered = (index === hoveredIdx);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, (outerR + outerInnerR) / 2, startAngle, endAngle);
      ctx.strokeStyle = this.getColor(centerText === 'Assets' ? index : index + 5);
      ctx.lineWidth = isHovered ? strokeWidthOuter + 4 : strokeWidthOuter;
      if (isHovered) {
        ctx.shadowColor = this.getColor(centerText === 'Assets' ? index : index + 5);
        ctx.shadowBlur = 10;
      }
      ctx.stroke();
      ctx.restore();

      // Draw label
      let labelText = `${item.label} ${item.pct.toFixed(1)}%`;
      if (baselineData.length > 0) {
        const baseItem = baselineData.find(b => b.label === item.label);
        if (baseItem) {
          const baseLabel = displayWidth < 400 ? 'B' : 'Base';
          labelText = `${item.label} ${item.pct.toFixed(1)}% (${baseItem.pct.toFixed(1)}% ${baseLabel})`;
        }
      }
      const middleAngle = startAngle + sliceAngle / 2;

      // Always draw labels OUTSIDE the chart with a pointer line to prevent slice text overflow
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

      let tx = ex + (isRight ? lineLength : -lineLength);
      const ty = finalY;

      ctx.save();
      ctx.font = '500 9px Outfit';
      const textWidth = ctx.measureText(labelText).width;
      let textX = tx + (isRight ? 4 : -4);

      if (isRight) {
        if (textX + textWidth > displayWidth - 4) {
          textX = Math.max(tx, displayWidth - textWidth - 4);
        }
      } else {
        if (textX - textWidth < 4) {
          textX = Math.min(tx, textWidth + 4);
        }
      }

      // Draw subtle pointer line
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, finalY);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.2)' : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw label text next to line end
      ctx.fillStyle = isLight ? '#475569' : '#9ca3af';
      ctx.textAlign = isRight ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      
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

    // Draw center text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '500 12px Outfit';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(centerText, cx, cy - 10);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Outfit';
    
    let centerVal = '';
    if (hoveredIdx !== -1 && data[hoveredIdx]) {
      centerVal = data[hoveredIdx].pct.toFixed(1) + '%';
    } else {
      const total = data.reduce((sum, x) => sum + x.value, 0);
      centerVal = this.formatCurrencyCompact(total);
    }
    ctx.fillText(centerVal, cx, cy + 10);
  }

  private colors = ['#00E5FF', '#8B5CF6', '#D946EF', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#6366F1', '#14B8A6', '#84CC16', '#EC4899'];
  public getColor(index: number): string {
    return this.colors[index % this.colors.length];
  }

  // Format currency helpers
  public formatVal(val: number, fromCurrency: string = 'USD'): string {
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate(fromCurrency, targetCurr);
    const converted = val * rate;
    const sym = this.service.getCurrencySymbol(targetCurr);
    return `${sym}${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private formatCurrencyCompact(val: number): string {
    const displayCurr = this.service.displayCurrency();
    const targetCurr = displayCurr === 'native' ? this.service.defaultCurrency() : displayCurr;
    const rate = this.service.getExchangeRate('USD', targetCurr);
    const converted = val * rate;
    const sym = this.service.getCurrencySymbol(targetCurr);
    
    if (converted >= 1e6) return `${sym}${(converted / 1e6).toFixed(1)}M`;
    if (converted >= 1e3) return `${sym}${(converted / 1e3).toFixed(1)}K`;
    return `${sym}${converted.toFixed(0)}`;
  }

  public getAbs(val: number): number {
    return Math.abs(val);
  }
}
