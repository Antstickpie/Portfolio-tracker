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

  // Pre-calculate sectors chart data
  public sectorChartData = computed(() => {
    const s = this.simulatedSummary();
    const isCost = this.allocationBasis() === 'cost';
    const total = isCost ? s.totalCostBasis : s.totalValue;
    if (total === 0) return [];
    
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
        pct: (value / total) * 100
      }))
      .sort((a, b) => b.value - a.value);
  });

  // Compute details of the hovered asset stock
  public hoveredAssetDetail = computed(() => {
    const idx = this.hoveredAssetIndex();
    const data = this.assetChartData();
    if (idx === -1 || !data[idx]) return null;
    
    const ticker = data[idx].label;
    const s = this.simulatedSummary();
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

  // Compute stocks belonging to the hovered sector
  public hoveredSectorStocks = computed(() => {
    const idx = this.hoveredSectorIndex();
    const data = this.sectorChartData();
    if (idx === -1 || !data[idx]) return [];
    
    const sectorName = data[idx].label;
    const s = this.simulatedSummary();
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

  // HTML5 Canvas Donut Chart rendering
  private drawCharts() {
    this.drawDonutChart(this.assetCanvas, this.assetChartData(), 'Assets');
    this.drawDonutChart(this.sectorCanvas, this.sectorChartData(), 'Sectors');
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
    const radius = Math.min(cx, cy) - 52;
    const innerRadius = radius * 0.48;

    if (data.length === 0) {
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

    let startAngle = -0.5 * Math.PI;
    const hoveredIdx = centerText === 'Assets' ? this.hoveredAssetIndex() : this.hoveredSectorIndex();
    const usedYRight: number[] = [];
    const usedYLeft: number[] = [];
    const isLight = this.service.theme() === 'light';

    data.forEach((item, index) => {
      const sliceAngle = (item.pct / 100) * 2 * Math.PI;
      const endAngle = startAngle + sliceAngle;
      const isHovered = (index === hoveredIdx);
      const strokeWidth = radius - innerRadius;

      ctx.beginPath();
      ctx.arc(cx, cy, (radius + innerRadius) / 2, startAngle, endAngle);
      ctx.strokeStyle = this.getColor(centerText === 'Assets' ? index : index + 5);
      ctx.lineWidth = isHovered ? strokeWidth + 4 : strokeWidth;
      ctx.stroke();

      // Draw label
      const labelText = `${item.label} ${item.pct.toFixed(1)}%`;
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

      const tx = ex + (isRight ? lineLength : -lineLength);
      const ty = finalY;

      ctx.save();
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
