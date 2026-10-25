const present = (value) => typeof value === 'string' && value.trim().length > 0 && !/^replace[-_ ]with\b/i.test(value.trim());

export function getIntegrationStatus(env = process.env) {
  const emailProvider = env.EMAIL_PROVIDER || 'disabled';
  const mediaProvider = env.MEDIA_STORAGE_PROVIDER || 'disabled';
  const paymentProvider = env.PAYMENT_PROVIDER || 'disabled';
  const emailMissing = emailProvider === 'resend'
    ? ['RESEND_API_KEY', 'EMAIL_FROM'].filter((name) => !present(env[name]))
    : emailProvider === 'disabled' ? [] : ['supported EMAIL_PROVIDER'];
  const mediaMissing = mediaProvider === 'cloudinary'
    ? ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((name) => !present(env[name]))
    : mediaProvider === 'disabled' ? [] : ['supported MEDIA_STORAGE_PROVIDER'];
  const paymentMissing = paymentProvider === 'mtn_momo'
    ? ['MOMO_SUBSCRIPTION_KEY', 'MOMO_API_USER', 'MOMO_API_KEY'].filter((name) => !present(env[name]))
    : paymentProvider === 'disabled' ? [] : ['supported PAYMENT_PROVIDER'];

  return {
    email: { provider: emailProvider, enabled: emailProvider !== 'disabled', configured: emailProvider === 'resend' && emailMissing.length === 0, missing: emailMissing },
    mediaStorage: { provider: mediaProvider, enabled: mediaProvider !== 'disabled', configured: mediaProvider === 'cloudinary' && mediaMissing.length === 0, missing: mediaMissing },
    payments: { provider: paymentProvider, enabled: paymentProvider !== 'disabled', configured: paymentProvider === 'mtn_momo' && paymentMissing.length === 0, missing: paymentMissing },
    identity: { provider: 'simulated_manual_review', enabled: true, configured: false, note: 'Official identity verification requires approved provider access.' }
  };
}
