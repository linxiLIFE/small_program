import cloudbase from '@cloudbase/js-sdk';

const env = import.meta.env.VITE_CLOUDBASE_ENV_ID || 'cloud1-d9g5pfect2ece00fa';

export const app = cloudbase.init({ env, region: 'ap-shanghai' });
export const auth = app.auth({ persistence: 'local' });

export interface AuthUser {
  uid?: string;
  username?: string;
  email?: string;
  phone?: string;
  displayName?: string;
  name?: string;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const state = await auth.getLoginState();
  if (!state || !state.user) return null;
  const raw = state.user as AuthUser & { id?: string; user_metadata?: { username?: string; name?: string } };
  return {
    ...raw,
    uid: raw.uid || raw.id,
    username: raw.username || raw.user_metadata?.username,
    name: raw.name || raw.user_metadata?.name
  };
}

export async function signIn(username: string, password: string): Promise<AuthUser> {
  const result = await auth.signInWithPassword({ username, password });
  if (result.error) throw new Error(result.error.message || '账号或密码错误');
  const user = await getCurrentUser();
  if (!user) throw new Error('登录成功但未建立 CloudBase 会话，请重试');
  return user;
}

export async function signOut(): Promise<void> {
  await auth.signOut();
}

export async function callBusiness<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await app.callFunction({
    name: 'api',
    data: { action, payload },
    parse: true
  });
  const result = response.result as { ok?: boolean; data?: T; requestId?:string; error?: { message?: string;code?:string } };
  if (!result || !result.ok) throw new Error((result?.error?.message || '业务请求失败') + (['INTERNAL_ERROR','SERVICE_UNAVAILABLE'].includes(result?.error?.code||'') && result?.requestId ? `（${result.requestId}）` : ''));
  return result.data as T;
}
