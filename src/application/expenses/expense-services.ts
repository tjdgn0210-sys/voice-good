import type { ManualExpenses } from './manual-expenses';
import type { Drafts } from '../drafts/drafts';
import type { ExpenseEditor } from './expense-editor';
import type { Transaction } from '../../domain/transaction/transaction';
export interface ExpenseServices extends ManualExpenses {
  drafts: Drafts;
  editor: ExpenseEditor;
  find(id: string): Promise<Transaction | null>;
  history(limit: number): Promise<Transaction[]>;
  summary(from: string, until: string): Promise<{ total: number; count: number }>;
}
