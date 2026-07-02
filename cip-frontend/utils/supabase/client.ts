import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Browser-side Supabase client (Client Components). Uses the publishable key. */
export const createClient = () => createBrowserClient(supabaseUrl!, supabaseKey!);
