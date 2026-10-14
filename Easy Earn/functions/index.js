/**
 * Easy Earn — Firebase Cloud Functions
 * Trusted Financial Operations, Atomic Transactions & Auditing
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Commission percentage defaults
const COMMISSION_RATES = {
  LEVEL_A: 0.10, // 10% direct
  LEVEL_B: 0.05, // 5% indirect
  LEVEL_C: 0.02  // 2% sub-team
};

/**
 * Helper: Check if caller has administrator permissions
 */
async function verifyAdminCaller(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  if (context.auth.token.admin === true || context.auth.token.role === 'admin') {
    return true;
  }
  // Check user profile document fallback
  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  if (userDoc.exists && userDoc.data().role === 'admin') {
    return true;
  }
  throw new functions.https.HttpsError('permission-denied', 'Administrative privileges required.');
}

/**
 * 1. purchasePackage (Callable)
 * Atomically verifies balance, deducts Recharge Wallet, activates investment,
 * evaluates VIP tier, and credits multi-tier team commissions.
 */
exports.purchasePackage = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userId = context.auth.uid;
  const { packageId, priceBDT, packageName, dailyReturnBDT, cycleDays, totalReturnBDT, vipReqLevel } = data;

  if (!packageId || !priceBDT || priceBDT <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid package details provided.');
  }

  return await db.runTransaction(async (transaction) => {
    const userRef = db.collection('users').doc(userId);
    const userSnap = await transaction.get(userRef);

    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User record not found.');
    }

    const userData = userSnap.data();
    if (userData.status === 'banned') {
      throw new functions.https.HttpsError('permission-denied', 'Account is suspended.');
    }

    const rechargeBalance = Number(userData.rechargeWallet || 0);
    if (rechargeBalance < priceBDT) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient Recharge Wallet balance.');
    }

    // 1. Deduct from recharge wallet, increase active invest
    const newRecharge = rechargeBalance - priceBDT;
    const newActiveInvest = Number(userData.activeInvest || 0) + priceBDT;
    const currentVip = Number(userData.activeVipLevel || 0);
    const newVip = Math.max(currentVip, Number(vipReqLevel || 0));

    transaction.update(userRef, {
      rechargeWallet: newRecharge,
      activeInvest: newActiveInvest,
      activeVipLevel: newVip
    });

    // 2. Create investment record
    const investmentRef = db.collection('investments').doc();
    transaction.set(investmentRef, {
      userId: userId,
      userPhone: userData.phone,
      packageId: packageId,
      packageName: packageName,
      amountBDT: priceBDT,
      dailyReturnBDT: dailyReturnBDT,
      cycleDays: cycleDays,
      totalReturnBDT: totalReturnBDT,
      daysRemaining: cycleDays,
      status: 'active',
      purchasedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3. Create immutable transaction entry
    const txRef = db.collection('transactions').doc();
    transaction.set(txRef, {
      userId: userId,
      type: 'investment',
      title: `Activated ${packageName}`,
      amountBDT: -priceBDT,
      status: 'completed',
      date: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4. Distribute multi-tier commissions up the referral chain
    let currentReferrerCode = userData.referredBy;

    // Level A (Direct: 10%)
    if (currentReferrerCode) {
      const refASnap = await db.collection('users').where('referralCode', '==', currentReferrerCode).limit(1).get();
      if (!refASnap.empty) {
        const refADoc = refASnap.docs[0];
        const refAId = refADoc.id;
        const commA = priceBDT * COMMISSION_RATES.LEVEL_A;

        transaction.update(refADoc.ref, {
          balanceWallet: admin.firestore.FieldValue.increment(commA),
          teamIncome: admin.firestore.FieldValue.increment(commA)
        });

        const commRecordRef = db.collection('commissionRecords').doc();
        transaction.set(commRecordRef, {
          userId: refAId,
          fromUserId: userId,
          fromUserPhone: userData.phone,
          level: 'A',
          percent: 10,
          amountBDT: commA,
          date: admin.firestore.FieldValue.serverTimestamp()
        });

        // Level B (Indirect: 5%)
        const refBCode = refADoc.data().referredBy;
        if (refBCode) {
          const refBSnap = await db.collection('users').where('referralCode', '==', refBCode).limit(1).get();
          if (!refBSnap.empty) {
            const refBDoc = refBSnap.docs[0];
            const refBId = refBDoc.id;
            const commB = priceBDT * COMMISSION_RATES.LEVEL_B;

            transaction.update(refBDoc.ref, {
              balanceWallet: admin.firestore.FieldValue.increment(commB),
              teamIncome: admin.firestore.FieldValue.increment(commB)
            });

            const commBRef = db.collection('commissionRecords').doc();
            transaction.set(commBRef, {
              userId: refBId,
              fromUserId: userId,
              fromUserPhone: userData.phone,
              level: 'B',
              percent: 5,
              amountBDT: commB,
              date: admin.firestore.FieldValue.serverTimestamp()
            });

            // Level C (Sub-Team: 2%)
            const refCCode = refBDoc.data().referredBy;
            if (refCCode) {
              const refCSnap = await db.collection('users').where('referralCode', '==', refCCode).limit(1).get();
              if (!refCSnap.empty) {
                const refCDoc = refCSnap.docs[0];
                const commC = priceBDT * COMMISSION_RATES.LEVEL_C;

                transaction.update(refCDoc.ref, {
                  balanceWallet: admin.firestore.FieldValue.increment(commC),
                  teamIncome: admin.firestore.FieldValue.increment(commC)
                });

                const commCRef = db.collection('commissionRecords').doc();
                transaction.set(commCRef, {
                  userId: refCDoc.id,
                  fromUserId: userId,
                  fromUserPhone: userData.phone,
                  level: 'C',
                  percent: 2,
                  amountBDT: commC,
                  date: admin.firestore.FieldValue.serverTimestamp()
                });
              }
            }
          }
        }
      }
    }

    return {
      success: true,
      newRechargeWallet: newRecharge,
      activeVipLevel: newVip
    };
  });
});

/**
 * 2. processDeposit (Admin Callable)
 * Approves or rejects deposit requests and credits Recharge Wallet atomically.
 */
exports.processDeposit = functions.https.onCall(async (data, context) => {
  await verifyAdminCaller(context);

  const { depositId, action, reason } = data; // action: 'approve' | 'reject'
  if (!depositId || !['approve', 'reject'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid deposit ID and action required.');
  }

  return await db.runTransaction(async (transaction) => {
    const depRef = db.collection('deposits').doc(depositId);
    const depSnap = await transaction.get(depRef);

    if (!depSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Deposit record not found.');
    }

    const depData = depSnap.data();
    if (depData.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', `Deposit has already been ${depData.status}.`);
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    transaction.update(depRef, {
      status: newStatus,
      reviewedBy: context.auth.uid,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewNote: reason || ''
    });

    if (action === 'approve') {
      const userRef = db.collection('users').doc(depData.userId);
      transaction.update(userRef, {
        rechargeWallet: admin.firestore.FieldValue.increment(depData.amountBDT),
        totalDeposit: admin.firestore.FieldValue.increment(depData.amountBDT)
      });
    }

    // Write to audit log
    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      action: `${action.toUpperCase()}_DEPOSIT`,
      depositId: depositId,
      amountBDT: depData.amountBDT,
      userPhone: depData.userPhone,
      adminUid: context.auth.uid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      reason: reason || ''
    });

    return { success: true, status: newStatus };
  });
});

/**
 * 3. processWithdrawal (Admin Callable)
 * Approves or rejects withdrawal requests. If rejected, refunds reserved balance.
 */
exports.processWithdrawal = functions.https.onCall(async (data, context) => {
  await verifyAdminCaller(context);

  const { withdrawalId, action, reason } = data; // action: 'approve' | 'reject'
  if (!withdrawalId || !['approve', 'reject'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid withdrawal ID and action required.');
  }

  return await db.runTransaction(async (transaction) => {
    const wdRef = db.collection('withdrawals').doc(withdrawalId);
    const wdSnap = await transaction.get(wdRef);

    if (!wdSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Withdrawal record not found.');
    }

    const wdData = wdSnap.data();
    if (wdData.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', `Withdrawal is already ${wdData.status}.`);
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    transaction.update(wdRef, {
      status: newStatus,
      reviewedBy: context.auth.uid,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewNote: reason || ''
    });

    // If rejected, refund the reserved funds back to Balance Wallet
    if (action === 'reject') {
      const userRef = db.collection('users').doc(wdData.userId);
      transaction.update(userRef, {
        balanceWallet: admin.firestore.FieldValue.increment(wdData.amountBDT)
      });
    }

    // Write to audit log
    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      action: `${action.toUpperCase()}_WITHDRAWAL`,
      withdrawalId: withdrawalId,
      amountBDT: wdData.amountBDT,
      userPhone: wdData.userPhone,
      adminUid: context.auth.uid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      reason: reason || ''
    });

    return { success: true, status: newStatus };
  });
});

/**
 * 4. distributeDailyYield (Scheduled / Callable)
 * Executes once every 24 hours to disburse daily returns into Balance Wallets.
 */
exports.distributeDailyYield = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
  const activeInvestments = await db.collection('investments').where('status', '==', 'active').get();
  const batch = db.batch();

  for (const doc of activeInvestments.docs) {
    const inv = doc.data();
    const dailyReturn = Number(inv.dailyReturnBDT || 0);
    const daysRemaining = Number(inv.daysRemaining || 1) - 1;

    // Credit user's Balance Wallet and record daily profit
    const userRef = db.collection('users').doc(inv.userId);
    batch.update(userRef, {
      balanceWallet: admin.firestore.FieldValue.increment(dailyReturn),
      profitEarned: admin.firestore.FieldValue.increment(dailyReturn),
      incomeToday: dailyReturn
    });

    // Update investment status
    if (daysRemaining <= 0) {
      batch.update(doc.ref, {
        daysRemaining: 0,
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      batch.update(doc.ref, {
        daysRemaining: daysRemaining
      });
    }
  }

  await batch.commit();
  console.log(`[Daily Yield] Distributed returns for ${activeInvestments.size} active packages.`);
  return null;
});

/**
 * 5. setAdminRole (Administrative CLI / Setup)
 */
exports.setAdminRole = functions.https.onCall(async (data, context) => {
  await verifyAdminCaller(context);
  const { targetUid } = data;
  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'Target UID is required.');
  }

  await admin.auth().setCustomUserClaims(targetUid, { admin: true, role: 'admin' });
  await db.collection('users').doc(targetUid).update({ role: 'admin' });

  return { success: true, message: `Admin privileges granted to UID: ${targetUid}` };
});
