import { create } from 'zustand';

interface DataState {
  familiesRev: number;
  transactionsRev: number;
  categoriesRev: number;
  membersRev: number;
  socialGiftsRev: number;

  invalidateFamilies: () => void;
  invalidateTransactions: () => void;
  invalidateCategories: () => void;
  invalidateMembers: () => void;
  invalidateSocialGifts: () => void;
  invalidateAll: () => void;
}

export const useDataStore = create<DataState>((set) => ({
  familiesRev: 0,
  transactionsRev: 0,
  categoriesRev: 0,
  membersRev: 0,
  socialGiftsRev: 0,

  invalidateFamilies: () => set((s) => ({ familiesRev: s.familiesRev + 1 })),
  invalidateTransactions: () => set((s) => ({ transactionsRev: s.transactionsRev + 1 })),
  invalidateCategories: () => set((s) => ({ categoriesRev: s.categoriesRev + 1 })),
  invalidateMembers: () => set((s) => ({ membersRev: s.membersRev + 1 })),
  invalidateSocialGifts: () => set((s) => ({ socialGiftsRev: s.socialGiftsRev + 1 })),
  invalidateAll: () =>
    set((s) => ({
      familiesRev: s.familiesRev + 1,
      transactionsRev: s.transactionsRev + 1,
      categoriesRev: s.categoriesRev + 1,
      membersRev: s.membersRev + 1,
      socialGiftsRev: s.socialGiftsRev + 1,
    })),
}));
