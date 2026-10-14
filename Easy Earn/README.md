# Easy Earn — Full-Stack Web Application

A modern, responsive, mobile-first web application featuring an entertainment-themed user portal, a secure Firebase backend, and a separate administrative dashboard.

---

## 1. Project Folder Structure

```text
Easy Earn/
├── index.html               # Main mobile-first user web application (Home, Product, VIP, Team, Me)
├── admin.html               # Dedicated administrative management portal
├── firestore.rules          # Production Cloud Firestore Security Rules
├── firestore.indexes.json   # Composite database query indexes
├── firebase.json            # Firebase Hosting, Firestore, and Functions deployment manifest
├── functions/               # Firebase Cloud Functions (Trusted Backend Operations)
│   ├── index.js             # Atomic transactions, yield distributor, commission engine
│   └── package.json         # Node.js dependencies for Cloud Functions
└── README.md                # Full system architecture, deployment, and test suite guide
```

---

## 2. Key Features & Reference UI Implementation

- **Bilingual Support (EN / BN)**: Full translation across English and বাংলা for all interfaces, navigation tabs, modal forms, error messages, and alerts.
- **Dual Currency Engine (BDT / USD)**: Single-currency base accounting in Bangladeshi Taka (৳) with automatic display conversion in USD ($) using a configurable exchange rate (`1 USD = 120 BDT`).
- **MXQ TV Box Entertainment Theme**: Recreated from official mobile web UI screenshots (`kukabot.cyou`), featuring promotional hero carousels, 4K media showcase, and floating "Spin & Win" carnival wheel.
- **Graphic CAPTCHA Verification**: Dynamic 4-digit verification code generation with noise lines preventing automated abuse.
- **VIP Membership & Privilege Matrix**: Multi-tier progression (VIP 0 to VIP 5) calculated strictly from verified database records (deposits or active referrals).
- **3-Tier Referral Commission Architecture**:
  - **Level A (Direct Team)**: 10%
  - **Level B (Indirect Team)**: 5%
  - **Level C (Sub-Team)**: 2%
- **Audited Financial Operations**: Complete separation of Recharge Wallet and Balance Wallet, pending approvals, balance locking on withdrawal request, and full audit logging.
- **Dual-Mode Engine (Live Firebase + Offline Local Demo)**: Runs seamlessly in any browser immediately without setup, and connects instantly to Firebase when deployed.

---

## 3. Firebase Project Setup Instructions

### Prerequisites
- Node.js (version 18 or 20)
- Firebase CLI installed globally:
  ```bash
  npm install -g firebase-tools
  ```

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and enter a name (e.g. `easy-earn-prod`).
3. Enable or skip Google Analytics as desired and create the project.

### Step 2: Enable Firebase Authentication
1. In the Firebase Console sidebar, select **Authentication** > **Get Started**.
2. Under the **Sign-in method** tab, enable:
   - **Phone** authentication (for SMS OTP verification in production).
   - **Email/Password** or **Anonymous** (if testing custom auth flows).

### Step 3: Enable Cloud Firestore
1. Select **Firestore Database** > **Create database**.
2. Select a location close to your primary audience (e.g., `asia-south1` Mumbai or `asia-southeast1` Singapore).
3. Start in **Production mode** (the provided `firestore.rules` will protect your collections).

### Step 4: Enable Firebase Storage (Optional for Proof Images)
1. Select **Storage** > **Get Started**.
2. Choose default security rules and match your Firestore database location.

### Step 5: Configure Web App Credentials
1. In the Project Settings (Gear icon) > **General** > **Your apps**, click the Web icon `</>`.
2. Register the app `Easy Earn Web`.
3. Copy the `firebaseConfig` object and update the `firebaseConfig` variables in both `index.html` and `admin.html`:
   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.appspot.com",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

---

## 4. Firestore Security Rules and Database Indexes

### Firestore Security Rules (`firestore.rules`)
Deploy using:
```bash
firebase deploy --only firestore:rules
```

Key security constraints enforced:
- **Client Privilege Denial**: Users cannot alter sensitive fields (`role`, `status`, `rechargeWallet`, `balanceWallet`, `activeVipLevel`, `totalDeposit`) directly from browser scripts.
- **Deposit / Withdrawal Integrity**: Regular users may only create records with `status == 'pending'`. Only verified administrators can transition a request to `'approved'` or `'rejected'`.
- **Audit Logs**: Read and write access is exclusively limited to administrator accounts.

### Database Composite Indexes (`firestore.indexes.json`)
Deploy using:
```bash
firebase deploy --only firestore:indexes
```
Configured indexes optimize queries by `userId + createdAt`, `status + createdAt`, and commission record aggregation.

---

## 5. Firebase Cloud Functions for Financial Operations

The backend functions in `functions/index.js` protect financial transactions against client-side tampering, race conditions, and double-spending:

1. **`purchasePackage`**:
   - Executes an atomic Firestore transaction (`db.runTransaction`).
   - Verifies the user has sufficient funds in their `rechargeWallet`.
   - Deducts the package price from `rechargeWallet` and increases `activeInvest`.
   - Evaluates whether the user qualifies for an upgraded VIP tier.
   - Calculates and disburses 3-tier commissions:
     - Level A (10% to direct referrer)
     - Level B (5% to indirect referrer)
     - Level C (2% to sub-referrer)
2. **`processDeposit`**:
   - Restricted to server-verified administrators.
   - Transitions pending deposits to approved or rejected.
   - Upon approval, credits the user's `rechargeWallet` and `totalDeposit` exactly once.
   - Logs an immutable record in `auditLogs`.
3. **`processWithdrawal`**:
   - Restricted to server-verified administrators.
   - Upon approval, marks the payout as completed.
   - Upon rejection, automatically refunds the reserved funds back into the user's `balanceWallet`.
   - Logs an immutable audit record.
4. **`distributeDailyYield`**:
   - Scheduled Cloud Function running every 24 hours (`every 24 hours`).
   - Iterates through active investments, credits daily profit into users' `balanceWallet`, and decrements cycle days remaining.
5. **`setAdminRole`**:
   - Administrative function to assign custom claims (`{ admin: true, role: 'admin' }`).

To deploy Cloud Functions:
```bash
cd functions
npm install
firebase deploy --only functions
```

---

## 6. Admin Role Provisioning Instructions

### Method A: Initial Local / Testing Access
Open `admin.html` in your browser. Use the pre-configured default administrator credentials:
- **Mobile Number**: `01700000000`
- **Master Password**: `admin123`

### Method B: Firebase Authentication Custom Claims (Production)
Run a one-time Node.js script using Firebase Admin SDK:

```javascript
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function grantAdmin(uid) {
  await admin.auth().setCustomUserClaims(uid, { admin: true, role: 'admin' });
  await admin.firestore().collection('users').doc(uid).set({
    role: 'admin'
  }, { merge: true });
  console.log(`Admin privileges successfully granted to UID: ${uid}`);
}

grantAdmin('TARGET_FIREBASE_UID_HERE');
```

---

## 7. Demo Data and Safe Local Testing Mode

The application includes an integrated **Local Persistence Mock Engine**:
- Allows testing all functionality immediately without requiring an active Firebase billing account or internet connection.
- Stores user accounts, deposits, withdrawals, package investments, and audit trails in browser `localStorage`.
- Automatically initializes with demonstration accounts:

| Role | Mobile Number | Password | Initial Balance | VIP Level |
|---|---|---|---|---|
| Regular User | `01811754943` | `123456` | ৳150.00 Recharge / ৳20.00 Balance | VIP 0 |
| Administrator | `01700000000` | `admin123` | System Master Account | VIP 5 |

### How to Test Locally:
1. Double-click or serve `index.html` via any local HTTP server (e.g., Python `python -m http.server 8000` or VS Code Live Server).
2. Login with user `01811754943` / `123456`.
3. Browse the **Products** tab and click **Marketing Plan** on "Hope rices 1" (৳10) or "Hope rices 2" (৳50) to purchase.
4. Check the **VIP** tab to observe tier metrics update.
5. Submit a Recharge request (e.g. ৳500 via bKash, TrxID: `TRX12345`).
6. Submit a Withdrawal request (e.g. ৳100 via Nagad).
7. Open `admin.html` in a separate tab or window.
8. Login as Admin (`01700000000` / `admin123`).
9. Navigate to the **Deposits** tab and click **✓ Approve & Credit**.
10. Navigate to the **Withdrawals** tab and click **✓ Approve Payout**.
11. Return to `index.html` to confirm updated wallet balances!

---

## 8. Authentication, Transaction, and Security Test Cases

### Test Suite 1: Authentication & Abuse Prevention
- **TC-1.1 Invalid CAPTCHA**: Enter valid mobile and password with an incorrect verification code. *Expected: Form submission rejected with alert.*
- **TC-1.2 Short Password**: Attempt registration with a 4-character password. *Expected: Blocked with minimum 6 character validation message.*
- **TC-1.3 Password Mismatch**: Attempt registration with different confirm password. *Expected: Blocked with matching error.*

### Test Suite 2: Financial Integrity & Atomic Deductions
- **TC-2.1 Insufficient Balance**: Attempt to purchase "DUCK FARM" (৳100) with only ৳10 in Recharge Wallet. *Expected: Purchase blocked with "Insufficient Recharge Wallet balance" toast.*
- **TC-2.2 Double Spend / Race Condition**: Trigger purchase simultaneously. *Expected: Transaction lock ensures deduction occurs exactly once.*
- **TC-2.3 Minimum Withdrawal Threshold**: Attempt to withdraw ৳50. *Expected: Blocked with "Minimum withdrawal is ৳100" notification.*
- **TC-2.4 Immediate Balance Lock**: Submit a ৳100 withdrawal. *Expected: ৳100 is deducted immediately from Balance Wallet so it cannot be double-spent while pending.*
- **TC-2.5 Withdrawal Rejection Refund**: Reject the pending withdrawal in `admin.html`. *Expected: ৳100 is refunded back into the user's Balance Wallet automatically.*

### Test Suite 3: Multi-Tier Referral Verification
- **TC-3.1 Level A Commission**: Register User B using User A's referral code. User B activates a ৳100 package. *Expected: User A receives exactly ৳10 (10%) in Balance Wallet.*
- **TC-3.2 Referral Loop Prevention**: System prevents self-referrals and circular chains.

---

## 9. Firebase Hosting Deployment Instructions

### Step 1: Login to Firebase CLI
```bash
firebase login
```

### Step 2: Initialize Project Configuration
From the project root directory:
```bash
firebase use --add
```
Select your Firebase project created in Step 3.

### Step 3: Deploy to Firebase Hosting
Deploy Firestore rules, composite indexes, Cloud Functions, and web assets in a single command:
```bash
firebase deploy
```

Once deployment completes, the CLI will output your live URL:
- **User Portal**: `https://<YOUR-PROJECT-ID>.web.app/`
- **Admin Portal**: `https://<YOUR-PROJECT-ID>.web.app/admin.html`

---

## 10. Production Security Checklist

- [x] **No Plaintext Passwords in Firestore**: User passwords are never saved in cleartext documents.
- [x] **Client-Side Balance Tampering Blocked**: Firestore security rules deny client writes to wallet fields.
- [x] **Server-Side Validation**: All package purchases, deposits, and payouts are calculated and committed via atomic transactions.
- [x] **No Hardcoded Admin Secrets**: Admin access verified via role claims and audit-logged operations.
- [x] **Abuse Prevention (CAPTCHA)**: Dynamic canvas graphics prevent brute-force credential stuffing.
- [x] **Risk Disclosures**: Prominently displayed unverified returns disclaimer on the Investment Products screen.
- [x] **Comprehensive Audit Logging**: Every administrative balance modification, approval, and rejection records an immutable audit log.
