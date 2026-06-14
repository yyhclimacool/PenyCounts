import type {
  BudgetRequest,
  BudgetWithSpent,
  SavingsGoal,
  SavingsGoalRequest,
} from '@/types';
import { api } from './api';

// ── Budgets ──────────────────────────────────────────────────────────

export async function listBudgets(): Promise<BudgetWithSpent[]> {
  const { data } = await api.get<BudgetWithSpent[]>('/budgets');
  return data;
}

export async function createBudget(req: BudgetRequest): Promise<void> {
  await api.post('/budgets', req);
}

export async function updateBudget(id: string, req: BudgetRequest): Promise<void> {
  await api.put(`/budgets/${id}`, req);
}

export async function deleteBudget(id: string): Promise<void> {
  await api.delete(`/budgets/${id}`);
}

// ── Savings goals ────────────────────────────────────────────────────

export async function listGoals(): Promise<SavingsGoal[]> {
  const { data } = await api.get<SavingsGoal[]>('/goals');
  return data;
}

export async function createGoal(req: SavingsGoalRequest): Promise<void> {
  await api.post('/goals', req);
}

export async function updateGoal(id: string, req: SavingsGoalRequest): Promise<void> {
  await api.put(`/goals/${id}`, req);
}

export async function deleteGoal(id: string): Promise<void> {
  await api.delete(`/goals/${id}`);
}
