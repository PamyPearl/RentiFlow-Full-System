import { Resend } from 'resend';

export function createResendMailer({ apiKey, from, client = apiKey ? new Resend(apiKey) : null }) {
  return {
    async send({ to, subject, text, html }) {
      if (!apiKey || !from || !client) throw new Error('Transactional email is not configured');
      if (typeof to !== 'string' || !to.trim() || typeof subject !== 'string' || !subject.trim()) {
        throw new Error('A recipient and subject are required');
      }
      if (!text && !html) throw new Error('Email text or HTML content is required');

      const recipient = to.trim();
      // Resend's shared test sender is only for simulated delivery and must never
      // be used to send application messages to real people.
      if (from.toLowerCase().includes('@resend.dev') && !recipient.toLowerCase().endsWith('@resend.dev')) {
        throw new Error('The Resend test sender can only be used with Resend test recipients');
      }

      const { data, error } = await client.emails.send({
        from,
        to: [recipient],
        subject: subject.trim(),
        ...(text ? { text } : {}),
        ...(html ? { html } : {})
      });
      if (error) throw new Error('Email delivery failed');
      return data;
    }
  };
}

export function createConfiguredMailer(env = process.env) {
  if ((env.EMAIL_PROVIDER || 'disabled') !== 'resend') throw new Error('EMAIL_PROVIDER must be set to resend to send email');
  return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
}
