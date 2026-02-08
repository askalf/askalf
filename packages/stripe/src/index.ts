// SUBSTRATE v1: Stripe Integration
// Handles billing, subscriptions, and payments

import Stripe from 'stripe';
import { query, queryOne } from '@substrate/database';
import {
  getSubscriptionByStripeId,
  setStripeCustomerId,
  updateSubscriptionStatus,
  changeSubscriptionPlan,
  getPlanByName,
} from '@substrate/auth';

// Initialize Stripe client (lazy to avoid crash if key not set)
const stripeSecretKey = process.env['STRIPE_SECRET_KEY'] ?? '';
const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    _stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });
  }
  return _stripe;
}

// Legacy export for compatibility (will throw if used without key)
export const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2025-02-24.acacia',
  typescript: true,
}) : (null as unknown as Stripe);

export function isStripeConfigured(): boolean {
  return !!stripeSecretKey;
}

// ============================================
// CUSTOMER MANAGEMENT
// ============================================

/**
 * Create or get Stripe customer for a tenant
 */
export async function getOrCreateCustomer(
  tenantId: string,
  email: string,
  name?: string
): Promise<Stripe.Customer> {
  // Check if customer already exists
  const existing = await queryOne<{ stripe_customer_id: string }>(
    'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1 AND stripe_customer_id IS NOT NULL LIMIT 1',
    [tenantId]
  );

  if (existing?.stripe_customer_id) {
    const customer = await stripe.customers.retrieve(existing.stripe_customer_id);
    if (!customer.deleted) {
      return customer as Stripe.Customer;
    }
  }

  // Create new customer
  const customerParams: Stripe.CustomerCreateParams = {
    email,
    metadata: {
      tenant_id: tenantId,
    },
  };
  if (name) {
    customerParams.name = name;
  }
  const customer = await stripe.customers.create(customerParams);

  // Save customer ID
  await setStripeCustomerId(tenantId, customer.id);

  return customer;
}

/**
 * Get Stripe customer by ID
 */
export async function getCustomer(customerId: string): Promise<Stripe.Customer | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return customer as Stripe.Customer;
  } catch {
    return null;
  }
}

// ============================================
// CHECKOUT SESSIONS
// ============================================

export interface CreateCheckoutOptions {
  tenantId: string;
  email: string;
  planName: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
}

/**
 * Create a Stripe checkout session for subscription
 */
export async function createCheckoutSession(
  options: CreateCheckoutOptions
): Promise<Stripe.Checkout.Session> {
  const { tenantId, email, planName, successUrl, cancelUrl, trialDays } = options;

  // Get plan price ID from database
  const plan = await getPlanByName(planName);
  if (!plan) {
    throw new Error(`Plan not found: ${planName}`);
  }

  // Use monthly price by default
  const stripePriceId = plan.stripe_price_monthly_id;
  if (!stripePriceId) {
    throw new Error(`Plan ${planName} has no Stripe price configured`);
  }

  // Get or create customer
  const customer = await getOrCreateCustomer(tenantId, email);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: customer.id,
    payment_method_types: ['card'],
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      tenant_id: tenantId,
      plan_name: planName,
    },
    subscription_data: {
      metadata: {
        tenant_id: tenantId,
        plan_name: planName,
      },
    },
  };

  // Add trial period if specified
  if (trialDays && trialDays > 0) {
    sessionParams.subscription_data = {
      ...sessionParams.subscription_data,
      trial_period_days: trialDays,
    };
  }

  return stripe.checkout.sessions.create(sessionParams);
}

/**
 * Create a Stripe checkout session for plan change/upgrade
 */
export async function createUpgradeSession(
  tenantId: string,
  newPlanName: string,
  successUrl: string,
  cancelUrl: string
): Promise<Stripe.Checkout.Session | null> {
  // Get current subscription
  const subscription = await queryOne<{ stripe_subscription_id: string; stripe_customer_id: string }>(
    `SELECT stripe_subscription_id, stripe_customer_id FROM subscriptions
     WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );

  if (!subscription?.stripe_subscription_id) {
    // No existing subscription, create a new checkout
    const user = await queryOne<{ email: string }>(
      'SELECT email FROM users WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );

    if (!user) {
      throw new Error('No user found for tenant');
    }

    return createCheckoutSession({
      tenantId,
      email: user.email,
      planName: newPlanName,
      successUrl,
      cancelUrl,
    });
  }

  // For existing subscriptions, use billing portal or subscription update
  return null; // Signal to use customer portal instead
}

// ============================================
// CUSTOMER PORTAL
// ============================================

/**
 * Create a Stripe billing portal session
 */
export async function createPortalSession(
  tenantId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const subscription = await queryOne<{ stripe_customer_id: string }>(
    'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1 AND stripe_customer_id IS NOT NULL',
    [tenantId]
  );

  if (!subscription?.stripe_customer_id) {
    throw new Error('No Stripe customer found for tenant');
  }

  return stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: returnUrl,
  });
}

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

/**
 * Cancel subscription at period end
 */
export async function cancelSubscriptionAtPeriodEnd(
  stripeSubscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
}

/**
 * Cancel subscription immediately
 */
export async function cancelSubscriptionImmediately(
  stripeSubscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.cancel(stripeSubscriptionId);
}

/**
 * Reactivate a cancelled subscription (before period end)
 */
export async function reactivateSubscription(
  stripeSubscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: false,
  });
}

/**
 * Update subscription to a new plan
 */
export async function updateSubscriptionPlan(
  stripeSubscriptionId: string,
  newStripePriceId: string
): Promise<Stripe.Subscription> {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

  if (!subscription.items.data[0]) {
    throw new Error('No subscription items found');
  }

  return stripe.subscriptions.update(stripeSubscriptionId, {
    items: [
      {
        id: subscription.items.data[0].id,
        price: newStripePriceId,
      },
    ],
    proration_behavior: 'create_prorations',
  });
}

// ============================================
// WEBHOOK HANDLING
// ============================================

export type WebhookEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.paid'
  | 'invoice.payment_failed';

/**
 * Verify and construct webhook event
 */
export function constructWebhookEvent(
  payload: Buffer | string,
  signature: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, stripeWebhookSecret);
}

/**
 * Handle Stripe webhook events
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    default:
      // Unhandled event type
      console.log(`Unhandled Stripe event type: ${event.type}`);
  }
}

/**
 * Handle checkout.session.completed
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = session.metadata?.['tenant_id'];
  const planName = session.metadata?.['plan_name'];

  if (!tenantId || !planName) {
    console.error('Missing metadata in checkout session');
    return;
  }

  const plan = await getPlanByName(planName);
  if (!plan) {
    console.error(`Plan not found: ${planName}`);
    return;
  }

  // Get subscription ID from session
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

  if (!subscriptionId) {
    console.error('No subscription ID in checkout session');
    return;
  }

  // Update or create subscription in database
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM subscriptions WHERE tenant_id = $1',
    [tenantId]
  );

  if (existing) {
    await query(
      `UPDATE subscriptions SET
        plan_id = $1,
        status = 'active',
        stripe_subscription_id = $2,
        stripe_customer_id = $3,
        updated_at = NOW()
       WHERE tenant_id = $4`,
      [plan.id, subscriptionId, session.customer, tenantId]
    );
  } else {
    await query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, stripe_subscription_id, stripe_customer_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, $5, NOW(), NOW())`,
      [`sub_${tenantId}`, tenantId, plan.id, subscriptionId, session.customer]
    );
  }
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const tenantId = subscription.metadata?.['tenant_id'];
  if (!tenantId) {
    console.error('Missing tenant_id in subscription metadata');
    return;
  }

  // Map Stripe status to our status
  let status: string;
  switch (subscription.status) {
    case 'active':
      status = subscription.cancel_at_period_end ? 'pending_cancellation' : 'active';
      break;
    case 'trialing':
      status = 'trialing';
      break;
    case 'past_due':
      status = 'past_due';
      break;
    case 'canceled':
    case 'unpaid':
      status = 'canceled';
      break;
    default:
      status = 'active';
  }

  await query(
    `UPDATE subscriptions SET
      status = $1,
      cancel_at_period_end = $2,
      current_period_start = $3,
      current_period_end = $4,
      updated_at = NOW()
     WHERE stripe_subscription_id = $5`,
    [
      status,
      subscription.cancel_at_period_end,
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000),
      subscription.id,
    ]
  );
}

/**
 * Handle subscription deleted
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await query(
    `UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = false, updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.subscription) return;

  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;

  // Record the payment
  await query(
    `INSERT INTO invoice_history (id, subscription_id, amount_paid, currency, status, stripe_invoice_id, paid_at, created_at)
     VALUES ($1, (SELECT id FROM subscriptions WHERE stripe_subscription_id = $2), $3, $4, 'paid', $5, NOW(), NOW())
     ON CONFLICT (stripe_invoice_id) DO NOTHING`,
    [
      `inv_${Date.now()}`,
      subscriptionId,
      invoice.amount_paid,
      invoice.currency,
      invoice.id,
    ]
  );

  // Update subscription status to active if it was past_due
  await query(
    `UPDATE subscriptions SET status = 'active', updated_at = NOW()
     WHERE stripe_subscription_id = $1 AND status = 'past_due'`,
    [subscriptionId]
  );
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.subscription) return;

  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;

  // Update subscription to past_due
  await query(
    `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscriptionId]
  );

  // Send payment failed email notification
  try {
    const subscription = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM subscriptions WHERE stripe_subscription_id = $1',
      [subscriptionId]
    );

    if (subscription) {
      const user = await queryOne<{ email: string; name: string }>(
        'SELECT email, name FROM users WHERE tenant_id = $1 LIMIT 1',
        [subscription.tenant_id]
      );

      if (user?.email) {
        // Use SendGrid if configured
        const sendgridKey = process.env['SENDGRID_API_KEY'];
        if (sendgridKey) {
          const sgMail = await import('@sendgrid/mail').then(m => m.default);
          sgMail.setApiKey(sendgridKey);
          await sgMail.send({
            to: user.email,
            from: process.env['FROM_EMAIL'] || 'noreply@askalf.org',
            subject: 'Payment Failed - Action Required',
            html: `
              <h2>Payment Failed</h2>
              <p>Hi ${user.name || 'there'},</p>
              <p>We were unable to process your payment for Ask ALF. Please update your payment method to continue using premium features.</p>
              <p><a href="${process.env['APP_URL'] || 'https://app.askalf.org'}/billing">Update Payment Method</a></p>
              <p>If you have any questions, reply to this email.</p>
              <p>– The Ask ALF Team</p>
            `,
          });
        }
      }
    }
  } catch (emailError) {
    console.error('Failed to send payment failed email:', emailError);
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get all invoices for a customer
 */
export async function getCustomerInvoices(
  customerId: string,
  limit: number = 10
): Promise<Stripe.Invoice[]> {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit,
  });
  return invoices.data;
}

/**
 * Get upcoming invoice for a subscription
 */
export async function getUpcomingInvoice(
  customerId: string,
  subscriptionId?: string
): Promise<Stripe.UpcomingInvoice | null> {
  try {
    const params: Stripe.InvoiceRetrieveUpcomingParams = {
      customer: customerId,
    };
    if (subscriptionId) {
      params.subscription = subscriptionId;
    }
    return await stripe.invoices.retrieveUpcoming(params);
  } catch {
    return null;
  }
}

/**
 * Sync Stripe prices with our plans table
 */
export async function syncStripePrices(): Promise<void> {
  const prices = await stripe.prices.list({
    active: true,
    expand: ['data.product'],
  });

  for (const price of prices.data) {
    const product = price.product as Stripe.Product;
    const planName = product.metadata?.['plan_name'];

    if (planName) {
      await query(
        `UPDATE plans SET stripe_price_id = $1 WHERE name = $2`,
        [price.id, planName]
      );
    }
  }
}
