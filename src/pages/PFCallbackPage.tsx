import { useEffect } from 'react';

// This page handles the OAuth callback from Practice Fusion
// It extracts the authorization code and sends it back to the parent window
export default function PFCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (window.opener) {
      if (code) {
        window.opener.postMessage({ type: 'pf-oauth-callback', code }, window.location.origin);
      } else if (error) {
        window.opener.postMessage(
          { type: 'pf-oauth-callback', error: params.get('error_description') || error },
          window.location.origin
        );
      }
      window.close();
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Completing authorization... This window will close automatically.</p>
    </div>
  );
}
