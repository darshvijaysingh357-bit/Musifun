class LyriaNotConfiguredError extends Error {}

/**
 * Calls Google's Lyria 3 via Vertex AI. Requires a Google Cloud project
 * with Vertex AI enabled and Lyria 3 access, plus a service account with
 * the Vertex AI User role. Set GOOGLE_CLOUD_PROJECT and
 * GOOGLE_APPLICATION_CREDENTIALS in .env to enable this.
 */
async function generateWithLyria({ prompt, durationSeconds }) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new LyriaNotConfiguredError(
      'Lyria 3 is not configured yet. Set GOOGLE_CLOUD_PROJECT and your Google Cloud credentials in .env.'
    );
  }

  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const model = durationSeconds <= 30 ? 'lyria-3-clip-preview' : 'lyria-3-pro-preview';
  const url = `https://aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/global/interactions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      duration_seconds: durationSeconds
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Lyria 3 request failed (HTTP ${response.status}): ${errBody}`);
  }

  const data = await response.json();
  return {
    audioBase64: data.audio_base64,
    mimeType: data.mime_type || 'audio/mpeg',
    modelUsed: model
  };
}

module.exports = { generateWithLyria, LyriaNotConfiguredError };
