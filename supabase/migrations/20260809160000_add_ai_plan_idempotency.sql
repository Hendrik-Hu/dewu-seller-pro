create table if not exists public.ai_plan_executions (
  plan_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('processing', 'completed')),
  result jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_plan_executions_user_created_idx
  on public.ai_plan_executions (user_id, created_at desc);

alter table public.ai_plan_executions enable row level security;
revoke all on table public.ai_plan_executions from anon, authenticated;

comment on table public.ai_plan_executions is
  'Server-only idempotency ledger for signed AI inventory plans.';
