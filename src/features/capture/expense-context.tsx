import { createContext, useContext } from 'react';
import type { ExpenseServices } from '../../application/expenses/expense-services';

export const ExpenseContext = createContext<ExpenseServices | null>(null);

export function useExpenses() {
  const services = useContext(ExpenseContext);
  if (!services) throw new Error('Expense services must be initialized before rendering screens.');
  return services;
}
