import { create } from 'zustand';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success';
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  toast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

function createAddToast(set: (fn: (state: ToastState) => Partial<ToastState>) => void) {
  return (toast: Omit<Toast, 'id'>) => {
    const id = String(++counter);
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 4000);
  };
}

function createRemoveToast(set: (fn: (state: ToastState) => Partial<ToastState>) => void) {
  return (id: string) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
}

export const useToast = create<ToastState>((set) => {
  const addToast = createAddToast(set);
  const removeToast = createRemoveToast(set);
  return {
    toasts: [],
    addToast,
    toast: addToast,
    removeToast,
    dismiss: removeToast,
  };
});
