import { validateSession, getUserById } from '@substrate/auth';

export async function getUserFromSession(request: { cookies?: Record<string, string | undefined> }) {
  const sessionId = request.cookies?.['substrate_session'];
  if (!sessionId) return null;

  const session = await validateSession(sessionId);
  if (!session) return null;

  return getUserById(session.user_id);
}
