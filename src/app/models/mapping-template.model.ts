export interface MappingTemplate {
  name: string;
  delimiter: string;
  hasHeader: boolean;
  mappings: {
    date: number;
    ticker: number;
    type: number;
    quantity: number;
    price: number;
    totalAmount: number;
    currency: number;
    fxRate: number;
  };
}
