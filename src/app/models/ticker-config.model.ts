export interface TickerConfig {
  ticker: string;
  currentPrice: number;
  priceCurrency: string; // currency the currentPrice is stored in (e.g. 'USD' for SNDK, 'EUR' for SECO)
  sector: string;
  name: string;
  logoData?: string;
  yahooSymbol?: string;
  customSector?: string;
  splitRatio?: number;
  splitDate?: string;
}
