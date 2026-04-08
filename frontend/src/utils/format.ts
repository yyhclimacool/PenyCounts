import dayjs from 'dayjs';

export function formatCurrency(amount: string | number, currency: string): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (Number.isNaN(n)) {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(0);
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(n);
}

export function formatDate(date: string): string {
  const d = dayjs(date);
  return d.isValid() ? d.format('YYYY-MM-DD') : date;
}

export function formatTime(time: string): string {
  if (!time) return '';
  const normalized = time.length === 5 ? `${time}:00` : time;
  const d = dayjs(`1970-01-01T${normalized}`);
  return d.isValid() ? d.format('HH:mm') : time;
}
