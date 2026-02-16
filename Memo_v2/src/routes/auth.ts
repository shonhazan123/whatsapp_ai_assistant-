import express, { Request, Response } from 'express';
import { googleOAuthService } from '../legacy/services/auth/GoogleOAuthService';
import { logger } from '../legacy/utils/logger';

export const authRouter = express.Router();

authRouter.get('/google', async (req: Request, res: Response) => {
  try {
    const stateToken = req.query.state;
    if (!stateToken || typeof stateToken !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid state parameter' });
    }

    const authorizationUrl = await googleOAuthService.getAuthorizationUrl(stateToken);
    res.redirect(authorizationUrl);
  } catch (error) {
    logger.error('Failed to initiate Google OAuth flow:', error);
    res.status(500).json({ error: 'Failed to start Google authentication' });
  }
});

authRouter.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code;
    const stateToken = req.query.state;

    if (!code || typeof code !== 'string' || !stateToken || typeof stateToken !== 'string') {
      return res.status(400).send(renderErrorPage('Missing authorization code or state parameter.'));
    }

    const result = await googleOAuthService.handleOAuthCallback(code, stateToken);

    const redirectUrl = result.state.redirectPath
      ? `${process.env.APP_PUBLIC_URL || ''}${result.state.redirectPath}`
      : null;

    if (redirectUrl) {
      return res.redirect(302, redirectUrl);
    }

    res.status(200).send(renderSuccessPage(result.profile.email));
  } catch (error) {
    logger.error('Error completing Google OAuth callback:', error);
    res.status(500).send(
      renderErrorPage('We could not connect your Google account. Please try again or contact support.')
    );
  }
});

function renderSuccessPage(email: string | null | undefined): string {
  const emailText = email ? ` (${email})` : '';
  return `
    <html>
      <head>
        <title>Google Connected</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 60px; background: #f7f7f7; }
          .container { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 480px; margin: auto; }
          h1 { color: #1a73e8; }
          p { color: #333; }
          a { color: #1a73e8; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Google Account Connected</h1>
          <p>Your Google account${emailText} is now linked successfully.</p>
          <p>You can return to WhatsApp and continue chatting with your assistant.</p>
        </div>
      </body>
    </html>
  `;
}

function renderErrorPage(message: string): string {
  return `
    <html>
      <head>
        <title>Google Connection Failed</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 60px; background: #fdf2f2; }
          .container { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 480px; margin: auto; }
          h1 { color: #d93025; }
          p { color: #333; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Connection Failed</h1>
          <p>${message}</p>
          <p>Please return to WhatsApp and try again.</p>
        </div>
      </body>
    </html>
  `;
}

export default authRouter;

