// gRPC status codes seen on ttsClient.synthesizeSpeech failures:
// 3=INVALID_ARGUMENT, 4=DEADLINE_EXCEEDED, 7=PERMISSION_DENIED,
// 8=RESOURCE_EXHAUSTED, 14=UNAVAILABLE, 16=UNAUTHENTICATED.
function classifyTtsError(err) {
  const text = `${err.message || ''} ${err.details || ''}`;
  if (/violation|content|safety|invalid_argument|blocked|policy/i.test(text) || err.code === 3) {
    return { code: 'CONTENT_OR_INVALID_ARGUMENT', retryable: false };
  }
  if (err.code === 8) return { code: 'QUOTA_EXCEEDED', retryable: false };
  if (err.code === 7 || err.code === 16) return { code: 'PERMISSION_DENIED', retryable: false };
  if (err.code === 14 || err.code === 4) return { code: 'TRANSIENT_UNAVAILABLE', retryable: true };
  return { code: 'UNKNOWN', retryable: false };
}

module.exports = { classifyTtsError };
