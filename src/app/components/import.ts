import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioService } from '../services/portfolio.service';
import { Transaction } from '../models/transaction.model';
import { MappingTemplate } from '../models/mapping-template.model';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './import.html',
  styleUrl: './import.css'
})
export class ImportComponent {
  public service = inject(PortfolioService);

  // Form State
  public rawText = '';
  public delimiter = '\t';
  public hasHeader = true;
  
  public selectedTemplateName = signal<string>('');
  public newTemplateName = '';

  // Default owner for transactions batch
  public defaultOwner = 'ownerA';
  public accountName = 'Account 1';

  // Parser output
  public parsedLines = signal<string[][]>([]);
  public isPreviewCollapsed = signal(false);

  // Column Mappings Model
  public columnMappings: Record<string, number> = {
    date: -1,
    ticker: -1,
    type: -1,
    quantity: -1,
    price: -1,
    totalAmount: -1,
    currency: -1,
    fxRate: -1,
    fees: -1,
  };

  // Target database fields
  public targetFields = [
    { key: 'date', label: 'Date / Time', required: true },
    { key: 'ticker', label: 'Ticker Symbol', required: false },
    { key: 'type', label: 'Transaction Type', required: true },
    { key: 'quantity', label: 'Quantity (Shares)', required: false },
    { key: 'price', label: 'Price per Share', required: false },
    { key: 'totalAmount', label: 'Total Value', required: true },
    { key: 'currency', label: 'Currency', required: false },
    { key: 'fxRate', label: 'FX Rate', required: false },
    { key: 'fees', label: 'Fees', required: false },
  ];

  // Grid helpers
  public availableColumnIndices = computed(() => {
    const lines = this.parsedLines();
    if (lines.length === 0) return [];
    // Get count from the longest of the first few lines
    const maxCols = Math.max(...lines.slice(0, 5).map((l: string[]) => l.length));
    return Array.from({ length: maxCols }, (_, i: number) => i);
  });

  public getHeaderName(idx: number): string {
    const lines = this.parsedLines();
    if (lines.length > 0 && this.hasHeader) {
      return lines[0][idx] || `Col ${idx + 1}`;
    }
    return `Col ${idx + 1}`;
  }

  public previewRows = computed(() => {
    const lines = this.parsedLines();
    if (lines.length === 0) return [];
    // Skip header line in preview rows if hasHeader is active
    const startIdx = this.hasHeader ? 1 : 0;
    return lines.slice(startIdx, startIdx + 8); // show max 8 rows
  });

  constructor() {
    // Select first template by default if available
    const tmpls = this.service.templates();
    if (tmpls.length > 0) {
      this.loadTemplateByName(tmpls[0].name);
    }
  }

  public onFileUploaded(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      this.rawText = e.target?.result as string;
      this.parsePreview();
      input.value = ''; // reset file input
    };
    reader.readAsText(file);
  }

  public onParserSettingsChange() {
    this.parsePreview();
  }

  public parsePreview() {
    // Auto-detect delimiter
    if (this.rawText.trim()) {
      const tabCount = (this.rawText.match(/\t/g) || []).length;
      const commaCount = (this.rawText.match(/,/g) || []).length;
      if (tabCount > commaCount && tabCount > 0) {
        this.delimiter = '\t';
      } else if (commaCount > 0) {
        this.delimiter = ',';
      }
    }

    const lines = this.service.parseRawText(this.rawText, this.delimiter);
    this.parsedLines.set(lines);
    
    // Auto-detect columns based on header matching
    if (lines.length > 0 && this.hasHeader) {
      const headers = lines[0].map(h => h.toLowerCase().trim());
      
      const findIndexForWords = (words: string[]): number => {
        return headers.findIndex((h) => words.some(w => h.includes(w)));
      };

      // Only auto detect if we don't have a template selected
      if (this.selectedTemplateName() === '') {
        this.columnMappings['date'] = findIndexForWords(['date', 'time', 'timestamp']);
        this.columnMappings['ticker'] = findIndexForWords(['ticker', 'symbol', 'stock', 'instrument']);
        this.columnMappings['type'] = findIndexForWords(['type', 'action', 'transaction']);
        this.columnMappings['quantity'] = findIndexForWords(['qty', 'quantity', 'shares', 'units']);
        this.columnMappings['price'] = findIndexForWords(['price', 'share price', 'rate']);
        this.columnMappings['totalAmount'] = findIndexForWords(['total', 'amount', 'value', 'net']);
        this.columnMappings['currency'] = findIndexForWords(['currency', 'ccy']);
        this.columnMappings['fxRate'] = findIndexForWords(['fx', 'exchange', 'rate']);
      }
    }
  }

  public onTemplateChange(name: string) {
    this.loadTemplateByName(name);
    // Reparse if rawText is not empty
    if (this.rawText.trim()) {
      this.parsePreview();
    }
  }

  public loadTemplateByName(name: string) {
    this.selectedTemplateName.set(name);
    if (!name) {
      // Clear mappings for manual selection
      this.columnMappings = { date: -1, ticker: -1, type: -1, quantity: -1, price: -1, totalAmount: -1, currency: -1, fxRate: -1, fees: -1 };
      return;
    }
    
    const t = this.service.templates().find((x) => x.name === name);
    if (t) {
      this.delimiter = t.delimiter;
      this.hasHeader = t.hasHeader;
      this.columnMappings = { ...t.mappings };
    }
  }

  public createNewSourceType() {
    const name = this.newTemplateName.trim();
    if (!name) return;
    
    const newTmpl: MappingTemplate = {
      name,
      delimiter: this.delimiter,
      hasHeader: this.hasHeader,
      mappings: {
        date: this.columnMappings['date'],
        ticker: this.columnMappings['ticker'],
        type: this.columnMappings['type'],
        quantity: this.columnMappings['quantity'],
        price: this.columnMappings['price'],
        totalAmount: this.columnMappings['totalAmount'],
        currency: this.columnMappings['currency'],
        fxRate: this.columnMappings['fxRate'],
        fees: this.columnMappings['fees'],
      }
    };

    this.service.saveTemplate(newTmpl);
    this.selectedTemplateName.set(name);
    this.newTemplateName = '';
    this.service.showToast(`Source Type "${name}" created! Mapped columns are ready.`, 'success');
  }

  public saveTemplateMappings() {
    const name = this.selectedTemplateName();
    if (!name) return;

    const t: MappingTemplate = {
      name,
      delimiter: this.delimiter,
      hasHeader: this.hasHeader,
      mappings: {
        date: this.columnMappings['date'],
        ticker: this.columnMappings['ticker'],
        type: this.columnMappings['type'],
        quantity: this.columnMappings['quantity'],
        price: this.columnMappings['price'],
        totalAmount: this.columnMappings['totalAmount'],
        currency: this.columnMappings['currency'],
        fxRate: this.columnMappings['fxRate'],
        fees: this.columnMappings['fees'],
      }
    };

    this.service.saveTemplate(t);
    this.service.showToast(`Mappings for "${name}" saved successfully!`, 'success');
  }

  public async deleteTemplate(name: string) {
    const ok = await this.service.showConfirm('Delete Source Type', `Delete source type "${name}"?`);
    if (ok) {
      this.service.deleteTemplate(name);
      this.selectedTemplateName.set('');
      this.loadTemplateByName('');
    }
  }

  public clearRawInput() {
    this.rawText = '';
    this.parsedLines.set([]);
  }

  public async importData() {
    const lines = this.parsedLines();
    if (lines.length === 0) return;

    // Check required fields
    if (this.columnMappings['date'] === -1) {
      this.service.showToast('Mapping Error: Date column is required.', 'error');
      return;
    }
    if (this.columnMappings['type'] === -1) {
      this.service.showToast('Mapping Error: Transaction Type column is required.', 'error');
      return;
    }
    if (this.columnMappings['totalAmount'] === -1) {
      this.service.showToast('Mapping Error: Total Amount column is required.', 'error');
      return;
    }

    const startIdx = this.hasHeader ? 1 : 0;
    const transactionsToImport: Transaction[] = [];



    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      if (line.length <= 1) continue;

      // Extract values based on mapping
      const dateVal = line[this.columnMappings['date']] || new Date().toISOString();
      const tickerVal = this.columnMappings['ticker'] !== -1 ? (line[this.columnMappings['ticker']] || '') : '';
      const typeVal = line[this.columnMappings['type']] || 'BUY';
      
      const cleanNum = (str: string): number => {
        if (!str) return 0;
        const cleaned = str.replace(/[^\d.-]/g, '');
        return parseFloat(cleaned) || 0;
      };

      const quantityVal = this.columnMappings['quantity'] !== -1 ? cleanNum(line[this.columnMappings['quantity']]) : 0;
      const priceVal = this.columnMappings['price'] !== -1 ? cleanNum(line[this.columnMappings['price']]) : 0;
      const totalAmountVal = cleanNum(line[this.columnMappings['totalAmount']]);
      
      const getCurrency = (cell: string): string => {
        if (!cell) return 'USD';
        const match = cell.match(/[A-Za-z]{3}/);
        return match ? match[0].toUpperCase() : 'USD';
      };
      
      const currencyVal = this.columnMappings['currency'] !== -1 ? getCurrency(line[this.columnMappings['currency']]) : 'USD';
      const fxRateVal = this.columnMappings['fxRate'] !== -1 ? cleanNum(line[this.columnMappings['fxRate']]) : 1;
      const feesVal = this.columnMappings['fees'] !== -1 ? cleanNum(line[this.columnMappings['fees']]) : 0;

      // Normalize types
      let normalizedType = typeVal.toUpperCase().trim();
      if (normalizedType.includes('BUY') || normalizedType.includes('PURCHASE')) {
        normalizedType = 'BUY';
      } else if (normalizedType.includes('SELL') || normalizedType.includes('SALE')) {
        normalizedType = 'SELL';
      } else if (normalizedType.includes('DIVIDEND') || normalizedType.includes('DIV')) {
        normalizedType = 'DIVIDEND';
      } else if (
        normalizedType.includes('DEPOSIT') || 
        normalizedType.includes('TOP-UP') || 
        normalizedType.includes('TOPUP') || 
        normalizedType.includes('TRANSFER') || 
        normalizedType.includes('CASH')
      ) {
        normalizedType = 'CASH TOP-UP';
      } else {
        // Skip importing other unknown rows
        continue;
      }

      // Allocate ownership according to the selected defaultOwner mode
      let bShares = 0;
      let bCostBasis = 0;
      let manualAllocation = true;

      // For cash top-ups, quantity and shares are 0
      const isCash = normalizedType === 'CASH TOP-UP';
      const actualQty = isCash ? 0 : quantityVal;

      const txCostVal = (fxRateVal && fxRateVal > 0.0001 && fxRateVal !== 1.0)
        ? parseFloat((totalAmountVal / fxRateVal).toFixed(2))
        : totalAmountVal;

      if (this.defaultOwner === 'ownerA') {
        bShares = 0;
        bCostBasis = 0;
      } else if (this.defaultOwner === 'ownerB') {
        bShares = actualQty;
        bCostBasis = txCostVal;
      } else {
        // split50
        bShares = parseFloat((actualQty * 0.5).toFixed(6));
        bCostBasis = parseFloat((txCostVal * 0.5).toFixed(2));
      }

      const aShares = parseFloat((actualQty - bShares).toFixed(6));
      const aCostBasis = parseFloat((txCostVal - bCostBasis).toFixed(2));

      const id = 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();

      transactionsToImport.push({
        id,
        date: dateVal,
        ticker: isCash ? '' : tickerVal.toUpperCase().trim(),
        type: normalizedType,
        quantity: actualQty,
        price: isCash ? 0 : (priceVal || (actualQty > 0 ? (txCostVal / actualQty) : 0)),
        totalAmount: txCostVal,
        currency: currencyVal,
        fxRate: fxRateVal || 1,
        source: this.accountName.trim() || this.selectedTemplateName() || 'Manual Clipboard',
        personBShares: bShares,
        personBCostBasis: bCostBasis,
        personAShares: aShares,
        personACostBasis: aCostBasis,
        manualAllocation,
        fees: feesVal || 0,
      });
    }

    if (transactionsToImport.length === 0) {
      this.service.showToast('No valid transactions found to import.', 'error');
      await this.service.showAlert(
        'Import Failed',
        'No valid transactions were found to import. Please check:\n\n1. Delimiter is set correctly (Comma vs Tab).\n2. Your column mappings are correctly aligned to the fields.\n3. The file has actual transaction rows (not just a header).\n4. The transaction types are recognized (e.g. BUY, SELL, DIVIDEND, or DEPOSIT/CASH TOP-UP).'
      );
      return;
    }

    const batchName = this.accountName.trim() || this.selectedTemplateName() || 'Manual Clipboard';
    
    // Filter out duplicate transactions
      const existingTxs = this.service.transactions();
      const existingSignatures = new Set(existingTxs.map(tx => this.service.getTransactionSignature(tx)));
      
      // Sanitize the imported transactions to match standard database conversions/precision before comparison
      const sanitizedToImport = this.service.sanitizeTransactions(transactionsToImport);
      
      const uniqueToImport: Transaction[] = [];
      let duplicateCount = 0;

      sanitizedToImport.forEach((tx) => {
        const sig = this.service.getTransactionSignature(tx);
        if (existingSignatures.has(sig)) {
          duplicateCount++;
        } else {
          uniqueToImport.push(tx);
          existingSignatures.add(sig); // prevent duplicates within the imported batch
        }
      });

      if (uniqueToImport.length === 0) {
        this.service.showToast('No new transactions to import. All rows were duplicates.', 'info');
        if (duplicateCount > 0) {
          await this.service.showAlert(
            'Duplicates Ignored',
            `All ${duplicateCount} rows in the batch were duplicates of existing transactions in your database and were skipped.`
          );
        }
        this.clearRawInput();
        return;
      }

      // Look up cached splits for unique transactions
      const cachedMatches = this.service.getCachedSplitsForTransactions(uniqueToImport);
      const matchCount = Object.keys(cachedMatches).length;
      
      if (matchCount > 0) {
        const restore = await this.service.showConfirm(
          'Restore Split Allocations?',
          `We found previous split configurations for ${matchCount} of the imported transactions. Would you like to restore them?`
        );
        if (restore) {
          uniqueToImport.forEach(tx => {
            const cache = cachedMatches[tx.id];
            if (cache) {
              tx.personBShares = cache.personBShares;
              tx.personBCostBasis = cache.personBCostBasis;
              tx.personAShares = parseFloat((tx.quantity - cache.personBShares).toFixed(6));
              tx.personACostBasis = parseFloat((tx.totalAmount - cache.personBCostBasis).toFixed(2));
              tx.manualAllocation = cache.manualAllocation;
            }
          });
          this.service.showToast(`Restored split configurations for ${matchCount} transactions.`, 'success');
        }
      }

      this.service.addTransactions(uniqueToImport);
      
      if (duplicateCount > 0) {
        this.service.showToast(`Imported ${uniqueToImport.length} transactions. Skipped ${duplicateCount} duplicates.`, 'info');
        await this.service.showAlert(
          'Duplicate Rows Skipped',
          `Successfully imported ${uniqueToImport.length} new transactions to "${batchName}".\n\nSkipped ${duplicateCount} duplicate transaction(s) that were already present in your database.`
        );
      } else {
        this.service.showToast(`Successfully imported ${uniqueToImport.length} transactions to "${batchName}"!`, 'success');
      }
      this.clearRawInput();
    }
  }
