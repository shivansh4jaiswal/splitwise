interface User {
  id: string;
  name: string | null;
  username: string;
}

interface ExpenseSplit {
  id: string;
  userId: string;
  amount: number;
  percentage?: number | null;
  isPaid: boolean;
  user: User;
}

interface Expense {
  id: string;
  title: string;
  amount: number;
  paidById: string;
  paidBy: User;
  splits: ExpenseSplit[];
}

interface Settlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  groupId: string;
  amount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  settledAt?: Date | null;
}

/**
 * Builds a skew-symmetric debt matrix where Debt[u1][u2] means u1 owes u2 this amount
 * The matrix is skew-symmetric: Debt[u1][u2] = -Debt[u2][u1]
 * 
 * @param groupMembers Array of user IDs in the group
 * @param expenses Array of expenses with splits
 * @param settlements Array of settlements
 * @returns A skew-symmetric debt matrix
 */
export function buildDebtMatrix(
  groupMembers: string[],
  expenses: Expense[],
  settlements: Settlement[]
): { [key: string]: { [key: string]: number } } {
  // Initialize debt matrix with zeros
  const debts: { [key: string]: { [key: string]: number } } = {};
  
  groupMembers.forEach(memberId => {
    debts[memberId] = {};
    groupMembers.forEach(otherMemberId => {
      if (memberId !== otherMemberId) {
        debts[memberId][otherMemberId] = 0;
      }
    });
  });

  // Process expenses
  expenses.forEach(expense => {
    const paidBy = expense.paidById;
    
    expense.splits.forEach(split => {
      const owesTo = split.userId;
      const amount = split.amount;
      
      // If someone paid and someone else owes, update the skew-symmetric matrix
      // Debt[owesTo][paidBy] means owesTo owes paidBy this amount
      if (paidBy !== owesTo) {
        debts[owesTo][paidBy] += amount;
        debts[paidBy][owesTo] -= amount; // Maintain skew-symmetry
      }
    });
  });

  // Process settlements
  settlements.forEach(settlement => {
    const fromUser = settlement.fromUserId;
    const toUser = settlement.toUserId;
    const amount = settlement.amount;
    
    // When fromUser pays toUser, reduce what toUser owes to fromUser
    // Debt[toUser][fromUser] += amount (reduces debt)
    // Debt[fromUser][toUser] -= amount (maintains skew-symmetry)
    debts[toUser][fromUser] += amount;
    debts[fromUser][toUser] -= amount;
  });

  return debts;
}

