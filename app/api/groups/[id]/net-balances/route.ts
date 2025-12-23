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

    console.log(debts);

    // Calculate net balances for the current user with each other member
    const currentUserId = payload.sub;
    const netBalancesList = [];

    for (const member of groupMembers) {
      if (member.userId === currentUserId) continue;

      // In skew-symmetric matrix: debts[u1][u2] = what u1 owes u2
      // Since the matrix is skew-symmetric, debts[u1][u2] = -debts[u2][u1]
      // Therefore, we only need to look at one direction to get the net balance
      // debts[member.userId][currentUserId] = what member owes to currentUser
      // For net balance, positive = they owe me, negative = I owe them
      const netAmount = debts[member.userId]?.[currentUserId] || 0;

      // Only include if there's a net balance (positive or negative)
      if (Math.abs(netAmount) > 0.01) { // Small threshold to avoid floating point issues
        netBalancesList.push({
          userId: member.userId,
          userName: member.user.name || member.user.username || 'Unknown',
          netAmount: netAmount,
          type: netAmount > 0 ? 'owed' : 'owes', // owed = they owe me, owes = I owe them
        });
      }
    }

    // Sort by absolute amount (highest first)
    netBalancesList.sort((a, b) => Math.abs(b.netAmount) - Math.abs(a.netAmount));

    return NextResponse.json({
      netBalances: netBalancesList,
      currentUserId,
    });
  } catch (error) {
    console.error('Error calculating net balances:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
