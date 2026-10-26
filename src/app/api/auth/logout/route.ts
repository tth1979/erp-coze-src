import { NextRequest } from 'next/server';
import { revokeSession, SESSION_COOKIE } from '@/server/auth/session';
import { handleError, ok } from '@/server/http';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) await revokeSession(token);
    const response = ok({ success: true });
    response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return handleError(error);
  }
}
