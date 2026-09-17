const RESEND_API_URL = 'https://api.resend.com/emails';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Sends the "Your Assistant" request via Resend's HTTPS API instead of SMTP.
 * Render's free tier blocks outbound SMTP ports, but HTTPS (this) isn't affected.
 * Uses Resend's default onboarding@resend.dev sender — this works without domain
 * verification as long as ASSISTANT_EMAIL matches the email your Resend account
 * was created with.
 *
 * Note: we deliberately do NOT set reply_to to the customer's email. Resend's
 * sandbox restriction (before a domain is verified) checks every address on the
 * request — including reply_to — so setting it to an arbitrary customer email
 * caused every real request to be rejected with a 403. The customer's email is
 * still included in the message body below, so nothing is lost — you just reply
 * to them manually rather than hitting "Reply" directly on this email.
 */
async function sendAssistantRequestEmail({ prompt, genre, durationSeconds, customerEmail, priceLabel }) {
  const to = process.env.ASSISTANT_EMAIL;
  if (!to) {
    throw new Error('ASSISTANT_EMAIL is not set in .env — add the inbox that should receive requests.');
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Email is not configured yet. Set RESEND_API_KEY in .env.');
  }

  console.log('DEBUG sendAssistantRequestEmail payload:', JSON.stringify({ to: [to], customerEmail }));
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'MusiFun <onboarding@resend.dev>',
      to: [to],
      subject: `MusiFun request — ${genre}, ${formatDuration(durationSeconds)}`,
      text: [
        'New track request from MusiFun (Your Assistant mode)',
        '',
        `Prompt: ${prompt && prompt.trim() ? prompt.trim() : '(none given)'}`,
        `Genre: ${genre}`,
        `Duration: ${formatDuration(durationSeconds)}`,
        `Price charged: ${priceLabel}`,
        `Customer email: ${customerEmail}`,
        '',
        `Reply directly to ${customerEmail} to send the finished track to the customer.`
      ].join('\n')
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Resend request failed (HTTP ${response.status}): ${errBody}`);
  }
}

module.exports = { sendAssistantRequestEmail, sendReviewEmail };

async function sendReviewEmail({ rating, comment, genre, durationSeconds, engine }) {
  const to = process.env.ASSISTANT_EMAIL;
  if (!to) {
    throw new Error('ASSISTANT_EMAIL is not set in .env — add the inbox that should receive reviews.');
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Email is not configured yet. Set RESEND_API_KEY in .env.');
  }

  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'MusiFun <onboarding@resend.dev>',
      to: [to],
      subject: `MusiFun review — ${rating}/5 stars`,
      text: [
        'New track review from MusiFun',
        '',
        `Rating: ${stars} (${rating}/5)`,
        `Genre: ${genre || '(not given)'}`,
        `Duration: ${durationSeconds ? formatDuration(durationSeconds) : '(not given)'}`,
        `Method: ${engine === 'lyria' ? 'Lyria 3' : 'Your Assistant'}`,
        '',
        `Comment: ${comment && comment.trim() ? comment.trim() : '(no comment left)'}`
      ].join('\n')
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Resend request failed (HTTP ${response.status}): ${errBody}`);
  }
}
