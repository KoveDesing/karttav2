// KARTTA Payments — plantillas de correo (HTML + texto). Estilo KARTTA: fondo gris claro, tarjeta blanca, rojo para la acción principal.
// Solo se renderizan tipos que el SERVIDOR encoló tras una verificación (nunca por una visita del cliente a la página de éxito).
const RED = '#FF3145', BG = '#F3F3F1', INK = '#2A2A2A', STRONG = '#0A0A0A', MUTED = '#777777', LINE = '#E6E6E3';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cop = new Intl.NumberFormat('es-CO');
export const money = (cents) => '$' + cop.format(Math.round(Number(cents || 0) / 100)) + ' COP';
export const dateEs = (iso) => iso ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '—';
const cycleEs = (c) => (c === 'annual' ? 'Anual' : 'Mensual');
const dayWord = (n) => (Number(n) === 1 ? '1 día' : `${Number(n)} días`);

function layout({ preheader, title, paragraphs, rows, cta, appUrl, restaurant }) {
  const rowsHtml = rows && rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-top:1px solid ${LINE}">${rows.map(([k, v]) =>
      `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px">${esc(k)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${LINE};color:${STRONG};font-size:14px;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>` : '';
  const btn = cta ? `<p style="margin:24px 0 4px"><a href="${esc(appUrl + cta.path)}" style="display:inline-block;background:${RED};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 22px;border-radius:12px">${esc(cta.label)}</a></p>` : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:${BG};font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || title)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 6px 14px;font-size:26px;font-weight:800;color:${STRONG};letter-spacing:-.02em">Kartta<span style="color:${RED}">.</span></td></tr>
<tr><td style="background:#fff;border:1px solid ${LINE};border-radius:16px;padding:28px 26px">
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:${STRONG}">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:14.5px;line-height:1.6">${esc(p)}</p>`).join('')}
${rowsHtml}${btn}
</td></tr>
<tr><td style="padding:16px 8px;font-size:12px;line-height:1.5;color:${MUTED}">Aviso automático sobre la suscripción de ${esc(restaurant || 'tu restaurante')} en KARTTA. Si no esperabas este mensaje, responde a este correo.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, '', ...paragraphs, ...(rows || []).map(([k, v]) => `${k}: ${v}`), cta ? `\n${cta.label}: ${appUrl}${cta.path}` : '', '\n— KARTTA'].join('\n');
  return { html, text };
}

/** @returns {{subject:string, html:string, text:string}|null} null si el tipo no existe. */
export function renderEmail(type, ctx, { appUrl, restaurant }) {
  const c = ctx || {}, plan = c.plan_name || (c.plan_id === 'pro' ? 'Pro' : c.plan_id === 'kartta' ? 'Standard' : 'tu plan');
  const receipt = () => [['Plan', `KARTTA ${plan}`], ['Modalidad', cycleEs(c.billing_cycle)], ['Importe', money(c.amount_in_cents)],
    ['Periodo', `${dateEs(c.period_start)} – ${dateEs(c.period_end)}`], ['Referencia', c.reference || '—']];
  const billing = { path: '/dashboard.html#facturacion', label: 'Ver mi facturación' };
  const buy = { path: '/checkout', label: 'Elegir un plan' };
  const M = {
    subscription_welcome: { subject: `Bienvenido a KARTTA ${plan}`, title: `¡Bienvenido a KARTTA ${plan}!`, paragraphs: ['Confirmamos tu pago y ya activamos tu plan. Estas son las condiciones de tu suscripción:'], rows: receipt(), cta: billing },
    trial_started: { subject: 'Empezó tu prueba gratuita de KARTTA', title: 'Tu prueba gratuita empezó', paragraphs: [`Puedes usar KARTTA hasta el ${dateEs(c.trial_end)}. No te cobraremos nada automáticamente: si quieres seguir con un plan de pago, lo eliges tú cuando quieras.`], cta: buy },
    trial_ending: { subject: `Tu prueba termina en ${dayWord(c.days)}`, title: `Tu prueba termina en ${dayWord(c.days)}`, paragraphs: [`El ${dateEs(c.trial_end)} termina tu prueba gratuita. No se hará ningún cobro automático.`, 'Para conservar las funciones de un plan de pago, elige Standard o Pro antes de esa fecha. Tu menú y tus datos se conservan en cualquier caso.'], cta: buy },
    payment_approved: { subject: 'Pago aprobado', title: 'Pago aprobado', paragraphs: ['Wompi confirmó tu pago. Este es tu comprobante:'], rows: receipt(), cta: billing },
    payment_pending: { subject: 'Tu pago está pendiente de confirmación', title: 'Tu pago está pendiente', paragraphs: ['Todavía no recibimos la confirmación de tu banco o medio de pago. No se ha activado ningún cambio en tu plan.', 'Te avisaremos por correo apenas se confirme. No necesitas pagar de nuevo.'], rows: [['Plan', `KARTTA ${plan}`], ['Importe', money(c.amount_in_cents)], ['Referencia', c.reference || '—']], cta: billing },
    payment_declined: { subject: 'No pudimos procesar tu pago', title: 'Tu pago no fue aprobado', paragraphs: ['El medio de pago rechazó la transacción, por lo que no se hizo ningún cobro ni cambio en tu plan.', 'Puedes intentarlo de nuevo con el mismo u otro medio de pago.'], rows: [['Plan', `KARTTA ${plan}`], ['Importe', money(c.amount_in_cents)], ['Referencia', c.reference || '—']], cta: { path: '/checkout', label: 'Intentar de nuevo' } },
    renewal_upcoming: { subject: `Tu plan ${plan} vence en ${dayWord(c.days)}`, title: `Tu plan vence en ${dayWord(c.days)}`, paragraphs: [`Tu plan KARTTA ${plan} vence el ${dateEs(c.period_end)}.`, c.auto_renew ? 'Se renovará automáticamente con el medio de pago que autorizaste.' : 'La renovación es manual: para no perder tus funciones, renueva desde KARTTA antes de esa fecha. No se cobra nada sin tu autorización.'], cta: { path: '/checkout', label: 'Renovar mi plan' } },
    renewal_success: { subject: 'Renovación exitosa', title: 'Renovamos tu plan', paragraphs: ['Confirmamos tu pago y extendimos tu suscripción.'], rows: receipt(), cta: billing },
    renewal_failed: { subject: 'No pudimos renovar tu plan', title: 'La renovación no se pudo completar', paragraphs: ['No fue posible cobrar la renovación de tu plan, por lo que tu suscripción venció. Puedes renovar manualmente cuando quieras.'], cta: { path: '/checkout', label: 'Renovar ahora' } },
    subscription_expiring: { subject: `Tu plan ${plan} termina pronto`, title: `Tu plan termina en ${dayWord(c.days)}`, paragraphs: [`Cancelaste la renovación, así que tu plan KARTTA ${plan} termina el ${dateEs(c.period_end)}.`, 'Si cambias de opinión, puedes reanudar la renovación desde Facturación.'], cta: billing },
    subscription_canceled: { subject: 'Cancelaste la renovación de tu plan', title: 'Renovación cancelada', paragraphs: [`Conservas tus funciones hasta el ${dateEs(c.period_end)}. Después, tu cuenta volverá al plan Free y tus datos se conservan.`, 'Puedes reanudar la renovación cuando quieras antes de esa fecha.'].filter(() => c.reason !== 'payment_voided').concat(c.reason === 'payment_voided' ? ['Un pago de tu suscripción fue anulado, por lo que el plan asociado dejó de estar vigente.'] : []), cta: billing },
    plan_updated: { subject: `Tu plan ahora es ${plan}`, title: `Tu plan ahora es ${plan}`, paragraphs: ['Confirmamos tu pago y actualizamos tu plan. Ya puedes usar sus funciones.'], rows: receipt(), cta: billing },
    subscription_expired: c.was_trial
      ? { subject: 'Terminó tu prueba gratuita', title: 'Tu prueba gratuita terminó', paragraphs: ['Tu menú y tus datos siguen intactos, pero tu cuenta volvió al plan Free.', 'Cuando quieras recuperar las funciones de un plan de pago, puedes contratarlo en minutos.'], cta: buy }
      : { subject: 'Tu suscripción venció', title: 'Tu suscripción venció', paragraphs: ['Tu plan de pago venció y tu cuenta volvió al plan Free. Tu menú y tus datos se conservan.', 'Puedes volver a contratar cuando quieras.'], cta: buy },
  };
  const m = M[type]; if (!m) return null;
  const { html, text } = layout({ ...m, preheader: m.paragraphs[0], appUrl, restaurant });
  return { subject: m.subject, html, text };
}
