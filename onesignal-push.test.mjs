import test from 'node:test';
import assert from 'node:assert/strict';
import { createOneSignalIdentitySynchronizer } from './kartta-onesignal-identity.mjs';
import {
  buildNotificationCopy,
  buildOneSignalPayload,
  classifyOneSignalResponse,
  isUuid,
  bogotaDaysRemaining,
  reminderTypeForSubscription,
  isReminderEligible,
  buildReminderDedupeKey,
} from './supabase/functions/onesignal-push/core.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const subscriptionId = '33333333-3333-4333-8333-333333333333';

test('validates UUIDs and rejects user-controlled identifiers', () => {
  assert.equal(isUuid(userId), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.throws(() => buildOneSignalPayload({ userId: 'another-user', restaurantId, notificationType: 'renewal_3d', restaurantName: 'KaKAO' }), /invalid_notification_identity/);
});

test('builds the exact 3-day reminder with the billing destination and one external ID', () => {
  const payload = buildOneSignalPayload({ userId, restaurantId, subscriptionId, notificationType: 'renewal_3d', restaurantName: 'KaKAO' });
  assert.deepEqual(payload.include_aliases.external_id, [userId]);
  assert.equal(payload.target_channel, 'push');
  assert.equal(payload.headings.es, '¡Hey! KARTTA te está esperando 👋');
  assert.match(payload.contents.es, /KaKAO/);
  assert.equal(payload.url, 'https://kartta.food/dashboard.html#facturacion');
  assert.equal(payload.data.notification_type, 'renewal_3d');
});

test('builds the exact 2-day reminder copy', () => {
  const copy = buildNotificationCopy('renewal_2d', 'La Suiza');
  assert.equal(copy.title, '¡Un recordatorio de KARTTA! ❤️');
  assert.match(copy.body, /La Suiza/);
});

test('supports separate trial reminder content', () => {
  assert.match(buildNotificationCopy('trial_ending_3d', 'Dilu').body, /periodo de prueba/);
  assert.match(buildNotificationCopy('trial_ending_2d', 'Dilu').body, /cerca de finalizar/);
});

test('never marks an API acceptance without an actual OneSignal message id as sent', () => {
  assert.deepEqual(classifyOneSignalResponse(200, {}), { status: 'skipped', providerId: null, error: 'no_subscribed_devices_for_user' });
  assert.deepEqual(classifyOneSignalResponse(201, { id: 'os-message-1' }), { status: 'sent', providerId: 'os-message-1', error: null });
  assert.equal(classifyOneSignalResponse(503, {}).status, 'failed');
});

test('calculates day boundaries in America/Bogota rather than raw UTC hours', () => {
  const now = '2026-11-06T13:00:00.000Z'; // 08:00 Bogotá
  assert.equal(bogotaDaysRemaining(now, '2026-11-09T12:00:00.000Z'), 3);
  assert.equal(bogotaDaysRemaining(now, '2026-11-08T23:59:00.000Z'), 2);
  assert.equal(bogotaDaysRemaining(now, '2026-11-06T23:00:00.000Z'), 0);
  assert.equal(bogotaDaysRemaining(now, '2026-11-16T13:00:00.000Z'), 10);
});

test('does not confuse two restaurants with different expiration dates', () => {
  const now = '2026-11-06T13:00:00.000Z';
  assert.equal(bogotaDaysRemaining(now, '2026-11-09T13:00:00.000Z'), 3);
  assert.equal(bogotaDaysRemaining(now, '2026-11-16T13:00:00.000Z'), 10);
});

test('maps only the 3-day and 2-day eligible subscription events', () => {
  assert.equal(reminderTypeForSubscription({ status: 'active', planId: 'kartta', daysRemaining: 3 }), 'renewal_3d');
  assert.equal(reminderTypeForSubscription({ status: 'active', planId: 'pro', daysRemaining: 2 }), 'renewal_2d');
  assert.equal(reminderTypeForSubscription({ status: 'trialing', planId: 'trial', daysRemaining: 3 }), 'trial_ending_3d');
  assert.equal(reminderTypeForSubscription({ status: 'active', planId: 'free', daysRemaining: 3 }), null);
  assert.equal(reminderTypeForSubscription({ status: 'expired', planId: 'kartta', daysRemaining: 2 }), null);
  assert.equal(reminderTypeForSubscription({ status: 'active', planId: 'kartta', daysRemaining: 10 }), null);
});

test('suppresses reminders for pending payments and suspended restaurants', () => {
  assert.equal(isReminderEligible({ status: 'active', planId: 'kartta', hasPendingPayment: true }), false);
  assert.equal(isReminderEligible({ status: 'active', planId: 'kartta', isSuspended: true }), false);
  assert.equal(isReminderEligible({ status: 'active', planId: 'kartta' }), true);
  assert.equal(isReminderEligible({ status: 'trialing', planId: 'trial' }), true);
});

test('dedupe key stays stable for a billing cycle and changes after renewal', () => {
  const a = buildReminderDedupeKey(subscriptionId, 'renewal_3d', '2026-11-09T12:00:00.000Z');
  const b = buildReminderDedupeKey(subscriptionId, 'renewal_3d', '2026-11-09T12:00:00.000Z');
  const c = buildReminderDedupeKey(subscriptionId, 'renewal_3d', '2026-12-09T12:00:00.000Z');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('serializes login, logout, and account switching without carrying an old identity', async () => {
  const calls = [];
  const mock = {
    User: { externalId: null },
    async login(id) { calls.push(['login', id]); this.User.externalId = id; },
    async logout() { calls.push(['logout']); this.User.externalId = null; },
  };
  const sync = createOneSignalIdentitySynchronizer(async () => mock);
  await Promise.all([sync(userId), sync(null), sync('44444444-4444-4444-8444-444444444444')]);
  assert.deepEqual(calls, [
    ['login', userId],
    ['logout'],
    ['login', '44444444-4444-4444-8444-444444444444'],
  ]);
});

test('logs out a persisted SDK identity even after a page reload', async () => {
  const calls = [];
  const mock = {
    User: { externalId: userId },
    async login(id) { calls.push(['login', id]); this.User.externalId = id; },
    async logout() { calls.push(['logout']); this.User.externalId = null; },
  };
  const sync = createOneSignalIdentitySynchronizer(async () => mock);
  await sync(null);
  assert.deepEqual(calls, [['logout']]);
});
