import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildOneSignalPayload,
  classifyOneSignalResponse,
  isUuid,
} from './core.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID') || '';
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY') || '';
const ALLOWED_ORIGINS = new Set([
  'https://kartta.food',
  'https://www.kartta.food',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function bearerToken(req: Request) {
  const value = req.headers.get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

async function authenticatedUser(req: Request) {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id || !isUuid(data.user.id)) return null;
  return data.user;
}

async function sendToExternalId(args: {
  userId: string;
  restaurantId: string;
  subscriptionId?: string | null;
  notificationType: string;
  restaurantName: string;
  eventId?: string | null;
  cycleEnd?: string | null;
}) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    throw new Error('onesignal_not_configured');
  }

  const payload = buildOneSignalPayload({
    appId: ONESIGNAL_APP_ID,
    userId: args.userId,
    restaurantId: args.restaurantId,
    subscriptionId: args.subscriptionId || null,
    notificationType: args.notificationType,
    restaurantName: args.restaurantName,
    eventId: args.eventId || null,
    cycleEnd: args.cycleEnd || null,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': 'Key ' + ONESIGNAL_REST_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let responseBody: Record<string, unknown> = {};
    try { responseBody = raw ? JSON.parse(raw) : {}; } catch { responseBody = {}; }
    return classifyOneSignalResponse(response.status, responseBody);
  } finally {
    clearTimeout(timeout);
  }
}

async function markNotification(id: string, status: string, error: string | null, providerId: string | null) {
  const { error: dbError } = await admin.rpc('onesignal_mark_notification', {
    p_id: id,
    p_status: status,
    p_error: error,
    p_provider_id: providerId,
  });
  if (dbError) throw new Error('notification_log_update_failed');
}

async function dispatchDueNotifications(cors: Record<string, string>, cronToken: string) {
  const { data: authorized, error: authError } = await admin.rpc('onesignal_verify_cron_token', {
    p_token: cronToken,
  });
  if (authError || authorized !== true) return json({ error: 'unauthorized' }, 401, cors);

  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    return json({ error: 'onesignal_not_configured' }, 503, cors);
  }

  const { data: enqueueResult, error: enqueueError } = await admin.rpc('onesignal_enqueue_due_reminders');
  if (enqueueError) {
    console.error('[KARTTA OneSignal] enqueue failed:', enqueueError.code || 'db_error');
    return json({ error: 'queue_generation_failed' }, 500, cors);
  }

  const { data: rows, error: claimError } = await admin.rpc('onesignal_claim_notifications', { p_limit: 100 });
  if (claimError) {
    console.error('[KARTTA OneSignal] claim failed:', claimError.code || 'db_error');
    return json({ error: 'queue_claim_failed' }, 500, cors);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const claimedRows = rows || [];
  // Process up to 100 rows with bounded concurrency to avoid sequential timeout spikes.
  for (let offset = 0; offset < claimedRows.length; offset += 10) {
    const batch = claimedRows.slice(offset, offset + 10);
    const outcomes = await Promise.all(batch.map(async (row) => {
      try {
        const { data: stillCurrent, error: currentError } = await admin.rpc('onesignal_notification_is_current', {
          p_id: row.id,
        });
        if (currentError) throw new Error('notification_state_check_failed');
        if (stillCurrent !== true) {
          await markNotification(row.id, 'cancelled', 'subscription_or_payment_changed_before_send', null);
          return 'skipped';
        }
        const result = await sendToExternalId({
          userId: row.user_id,
          restaurantId: row.restaurant_id,
          subscriptionId: row.subscription_id,
          notificationType: row.notification_type,
          restaurantName: row.restaurant_name,
          eventId: row.id,
          cycleEnd: row.cycle_end,
        });
        await markNotification(row.id, result.status, result.error, result.providerId);
        return result.status;
      } catch (error) {
        const safeError = error instanceof Error ? error.message : 'onesignal_send_failed';
        try { await markNotification(row.id, 'failed', safeError.slice(0, 300), null); }
        catch { console.error('[KARTTA OneSignal] failed to persist notification result:', row.id); }
        return 'failed';
      }
    }));
    for (const outcome of outcomes) {
      if (outcome === 'sent') sent++;
      else if (outcome === 'skipped' || outcome === 'cancelled') skipped++;
      else failed++;
    }
  }

  return json({
    ok: true,
    queued: Number(enqueueResult?.queued || 0),
    claimed: (rows || []).length,
    sent,
    skipped,
    failed,
  }, 200, cors);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_not_allowed' }, 403, cors);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 8192) return json({ error: 'payload_too_large' }, 413, cors);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }

  if (body.action === 'dispatch') {
    const cronToken = req.headers.get('x-kartta-cron-token') || '';
    return await dispatchDueNotifications(cors, cronToken);
  }

  if (body.action === 'test') {
    const user = await authenticatedUser(req);
    if (!user) return json({ error: 'unauthorized' }, 401, cors);
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) return json({ error: 'onesignal_not_configured' }, 503, cors);

    const { data: membership, error: membershipError } = await admin
      .from('restaurant_members')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError || !membership?.restaurant_id) return json({ error: 'restaurant_membership_required' }, 403, cors);

    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .select('id,name')
      .eq('id', membership.restaurant_id)
      .maybeSingle();
    if (restaurantError || !restaurant) return json({ error: 'restaurant_not_found' }, 404, cors);

    const { data: testSlot, error: slotError } = await admin.rpc('onesignal_claim_test_slot', {
      p_user_id: user.id,
    });
    if (slotError) return json({ error: 'test_rate_limit_unavailable' }, 500, cors);
    if (testSlot !== true) return json({ error: 'test_rate_limited' }, 429, cors);

    try {
      const result = await sendToExternalId({
        userId: user.id,
        restaurantId: restaurant.id,
        notificationType: 'manual_test',
        restaurantName: restaurant.name,
      });
      const { error: finishError } = await admin.rpc('onesignal_finish_test_slot', {
        p_user_id: user.id,
        p_status: result.status,
        p_provider_id: result.providerId,
        p_error: result.error,
      });
      if (finishError) console.error('[KARTTA OneSignal] test result log failed:', finishError.code || 'db_error');
      if (result.status === 'sent') return json({ status: 'sent' }, 200, cors);
      if (result.status === 'skipped') return json({ status: 'no_subscriptions' }, 200, cors);
      return json({ status: 'failed' }, 502, cors);
    } catch {
      await admin.rpc('onesignal_finish_test_slot', {
        p_user_id: user.id,
        p_status: 'failed',
        p_provider_id: null,
        p_error: 'test_push_failed',
      });
      return json({ error: 'test_push_failed' }, 502, cors);
    }
  }

  return json({ error: 'invalid_action' }, 400, cors);
});
