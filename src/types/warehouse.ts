// Raw picking benchmark data from Page 1
export interface RawBenchmarkEntry {
  merchant_name: string;
  picking_benchmark: number;
  picking_type: string;
}

// Processed benchmark (Page 3 result)
export interface BenchmarkEntry {
  merchant_name: string;
  benchmark: number;
}

// Flow management row (Page 6)
export interface FlowManagementRow {
  merchant_name: string;
  order_volume: number;
  waiting_for_picking: number;
  picking_hours: number;
  packing_hours: number;
  ideal_sph: number;
}

// Order status from Page 5
export interface OrderStatusEntry {
  merchant: string;
  status: string;
  shipment_count: number;
  totals: number;
}

// Performance entry from Page 9
export interface PickingPerformanceEntry {
  date: string;
  merchant_name: string;
  full_name: string;
  according_to_picking_benchmark: string;
  total_performance: string;
  picking_benchmark: number;
  total_shipments_picked: number;
  picking_sph: number;
  real_time: number;
  ideal_time: number;
}

// Packing performance from Page 10
export interface PackingPerformanceEntry {
  date: string;
  warehouse_name: string;
  merchant_name: string;
  packing_benchmark: number;
  full_name: string;
  total_shipments_packed: number;
  packing_sph: number;
  according_to_packing_benchmark: string;
  total_performance: string;
  real_time: number;
  ideal_time: number;
}
