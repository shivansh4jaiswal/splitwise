import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/app/lib/prisma';
import { verifyAuthToken, authCookieOptions } from '@/app/lib/auth';
import { buildDebtMatrix } from '@/app/lib/debtMatrix';

export async function POST(
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
    const { toUserId, amount } = await request.json();

    // Validate input
    if (!toUserId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid settlement data' },
        { status: 400 }
      );
    }

    // Check if both users are members of the group
    const memberships = await prisma.groupMember.findMany({
      where: {
        groupId: groupId,
        userId: { in: [payload.sub, toUserId] },
      },
    });

    if (memberships.length !== 2) {
      return NextResponse.json(
        { error: 'One or both users are not members of this group' },
        { status: 403 }
      );
    }

    // Check if there's actually a debt to settle
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

    // Get completed settlements to adjust debt
    const settlements = await prisma.settlement.findMany({
      where: {
        groupId: groupId,
        status: 'COMPLETED',
      },
    });

    // Get all group members to build the matrix
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId },
    });
    const userIds = groupMembers.map(m => m.userId);

    // Build skew-symmetric debt matrix
    const debts = buildDebtMatrix(userIds, expenses, settlements);

    // Get current debt: Debt[currentUser][toUser] means currentUser owes toUser
    // If positive, currentUser owes toUser; if negative, toUser owes currentUser
    const currentDebt = debts[payload.sub]?.[toUserId] || 0;

    // Validate settlement amount - currentUser can only pay if they owe (positive debt)
    if (currentDebt < 0) {
      return NextResponse.json(
        { error: 'This user owes you money, you cannot settle with them' },
        { status: 400 }
      );
    }

    if (amount > currentDebt) {
      return NextResponse.json(
        { error: 'Settlement amount exceeds outstanding debt' },
        { status: 400 }
      );
    }

    // Create settlement record
    const settlement = await prisma.settlement.create({
      data: {
        fromUserId: payload.sub,
        toUserId: toUserId,
        groupId: groupId,
        amount: amount,
        status: 'COMPLETED',
        settledAt: new Date(),
      },
      include: {
        fromUser: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        toUser: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    return NextResponse.json({
      message: 'Settlement completed successfully',
      settlement: settlement,
    });
  } catch (error) {
    console.error('Error creating settlement:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
