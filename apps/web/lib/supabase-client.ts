import { createBrowserClient } from '@supabase/ssr';
import { clearClientCache } from '@/lib/client-cache';

export function getSupabaseBrowserClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://dummy-auth-url.supabase.co';
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    'dummy-anon-key';

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Perform application sign-out:
 * 1. Purges client sessionStorage and in-memory cache via clearClientCache()
 * 2. Revokes Supabase Auth session
 * 3. Redirects to sign-in page
 */
export async function handleSignOut(router?: { push: (href: string) => void }) {
  clearClientCache();
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
  } catch {
    // Continue redirect even if network request fails
  }

  if (router) {
    router.push('/signin');
  } else if (typeof window !== 'undefined') {
    window.location.href = '/signin';
  }
}

