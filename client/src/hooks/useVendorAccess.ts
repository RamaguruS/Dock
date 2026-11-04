import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export type AccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface WarehouseAccess {
  _id: string;
  status: AccessStatus;
  warehouseId: {
    _id: string;
    name: string;
    address: string;
    timezone: string;
  };
}

export const VENDOR_ACCESS_QUERY_KEY = ['vendorAccess'];

/** The logged-in vendor's per-warehouse access records. */
export const useVendorAccess = () =>
  useQuery<WarehouseAccess[]>({
    queryKey: VENDOR_ACCESS_QUERY_KEY,
    queryFn: async () => (await api.get('/api/vendors/me/access')).data.access,
  });
