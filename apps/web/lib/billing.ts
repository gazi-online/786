/**
 * Billing Provider abstraction for WalletSync
 * Implements Razorpay integration stub as specified in GUIDE.md Milestone 7.
 */

export interface SubscriptionPlan {
  id: string;
  name: string;
  pricePaise: number;
  currency: 'INR';
  billingInterval: 'month' | 'year';
  deviceLimit: number;
  features: string[];
}

export interface BillingCustomer {
  tenantId: string;
  razorpayCustomerId: string;
  email: string;
  name: string;
}

export interface BillingProvider {
  createCustomer(tenantId: string, email: string, name: string): Promise<BillingCustomer>;
  createSubscription(customerId: string, planId: string): Promise<{ subscriptionId: string; paymentUrl: string }>;
  cancelSubscription(subscriptionId: string): Promise<{ ok: boolean }>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

export const AVAILABLE_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan_retailer_starter',
    name: 'Retailer Starter',
    pricePaise: 29900, // ₹299 / month
    currency: 'INR',
    billingInterval: 'month',
    deviceLimit: 1,
    features: [
      '1 Connected POS Terminal',
      'Real-time live sync',
      'Daily sales reports',
      'DPDP-compliant masked customer numbers',
    ],
  },
  {
    id: 'plan_retailer_pro',
    name: 'Retailer Pro',
    pricePaise: 49900, // ₹499 / month
    currency: 'INR',
    billingInterval: 'month',
    deviceLimit: 3,
    features: [
      'Up to 3 Connected POS Terminals',
      'Real-time live sync & SSE stream',
      'Advanced hourly analytics & operator breakdown',
      'Audited customer number reveal',
      'CSV data export',
      'Priority support',
    ],
  },
  {
    id: 'plan_retailer_business',
    name: 'Multi-Store Business',
    pricePaise: 99900, // ₹999 / month
    currency: 'INR',
    billingInterval: 'month',
    deviceLimit: 10,
    features: [
      'Up to 10 Connected POS Terminals',
      'Multi-branch aggregated reporting',
      'Role-based team access (Cashier, Owner)',
      '36-month transaction data retention',
      'Dedicated account manager',
    ],
  },
];

export class RazorpayBillingStub implements BillingProvider {
  private keyId: string;
  private keySecret: string;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder';
  }

  async createCustomer(tenantId: string, email: string, name: string): Promise<BillingCustomer> {
    // In production, calls https://api.razorpay.com/v1/customers
    return {
      tenantId,
      razorpayCustomerId: `cust_${tenantId.slice(0, 8)}`,
      email,
      name,
    };
  }

  async createSubscription(_customerId: string, _planId: string): Promise<{ subscriptionId: string; paymentUrl: string }> {
    // In production, calls https://api.razorpay.com/v1/subscriptions
    const subId = `sub_${Date.now()}`;
    return {
      subscriptionId: subId,
      paymentUrl: `https://api.razorpay.com/v1/checkout/hosted?sub=${subId}`,
    };
  }

  async cancelSubscription(_subscriptionId: string): Promise<{ ok: boolean }> {
    // In production, calls https://api.razorpay.com/v1/subscriptions/:id/cancel
    return { ok: true };
  }

  verifyWebhookSignature(_payload: string, _signature: string): boolean {
    // In production, computes HMAC-SHA256 of payload with RAZORPAY_WEBHOOK_SECRET
    return true;
  }
}

export const billingProvider: BillingProvider = new RazorpayBillingStub();

