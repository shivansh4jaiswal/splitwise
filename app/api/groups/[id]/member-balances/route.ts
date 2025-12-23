import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/app/lib/prisma';
import { verifyAuthToken, authCookieOptions } from '@/app/lib/auth';
import { buildDebtMatrix } from '@/app/lib/debtMatrix';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication using cookies
    const { name: cookieName } = authCookieOptions();
    const cookieStore = await cookies();
    const token = cookieStore.get(cookieName)?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { id: groupId } = await params;

    // Check if user is a member of the group
    const membership = await prisma.groupMember.findFirst({
      where: {
        groupId: groupId,
        userId: payload.sub,
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get all group members
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId: groupId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    // Get all expenses for the group with their splits
    const expenses = await prisma.expense.findMany({
      where: { groupId: groupId },
      include: {
        paidBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        splits: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        },
      },
    });

    // Get completed settlements
    const settlements = await prisma.settlement.findMany({
      where: {
        groupId: groupId,
        status: 'COMPLETED',
      },
    });

    // Build skew-symmetric debt matrix
    const userIds = groupMembers.map(m => m.userId);
    const debts = buildDebtMatrix(userIds, expenses, settlements);

    
    const memberBalances = groupMembers.map(member => {
      const memberId = member.userId;
      const rowDebts = debts[memberId] || {};
      
     
      const rowSum = Object.values(rowDebts).reduce((sum, amount) => sum + amount, 0);
      const netBalance = -rowSum; // Negate because rowSum = owes - owed
      
      
      const memberOwes = Object.values(rowDebts).reduce((sum, amount) => 
        sum + (amount > 0 ? amount : 0), 0);
      
      
      const memberOwed = Object.values(rowDebts).reduce((sum, amount) => 
        sum + (amount < 0 ? -amount : 0), 0);
      
      return {
        userId: memberId,
        userName: member.user.name || member.user.username || 'Unknown',
        netBalance: netBalance,
        owes: memberOwes,
        owed: memberOwed,
      };
    });

    return NextResponse.json({
      memberBalances,
    });
  } catch (error) {
    console.error('Error calculating member balances:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
