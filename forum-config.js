// Supabase project for accounts and the forum (Project Settings -> API Keys in Supabase).
// anonKey is the PUBLISHABLE key (sb_publishable_...), which is meant to be public: what it can
// do is limited by the rules in supabase/*.sql. Never put the secret key (sb_secret_...) here.
// With anonKey empty, accounts are off and the Forum tab shows "coming soon".
const FORUM_CONFIG = {
  url: "https://ylikzijegwoxrrtbswyl.supabase.co",
  anonKey: "sb_publishable_sCYVq54MOSw7Q_78GWSDMA_PednV-sw",
};
