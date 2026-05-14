
-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end; $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- datasets
create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  columns jsonb not null default '[]'::jsonb,
  feature_columns jsonb not null default '[]'::jsonb,
  target_column text,
  row_count int not null default 0,
  sample_rows jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.datasets enable row level security;
create policy "own datasets all" on public.datasets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- models
create table public.models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dataset_id uuid references public.datasets(id) on delete set null,
  name text not null,
  algorithm text not null default 'logistic_regression',
  status text not null default 'pending',
  weights jsonb not null default '[]'::jsonb,
  intercept double precision not null default 0,
  feature_columns jsonb not null default '[]'::jsonb,
  feature_means jsonb not null default '[]'::jsonb,
  feature_stds jsonb not null default '[]'::jsonb,
  threshold double precision not null default 0.5,
  metrics jsonb not null default '{}'::jsonb,
  training_log text,
  is_active boolean not null default false,
  trained_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.models enable row level security;
create policy "own models all" on public.models for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- predictions
create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model_id uuid references public.models(id) on delete set null,
  robot_id text not null,
  sensors jsonb not null,
  probability double precision not null,
  risk_level text not null,
  shap_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.predictions enable row level security;
create policy "own predictions all" on public.predictions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index on public.predictions (user_id, created_at desc);
create index on public.predictions (robot_id, created_at desc);

-- realtime
alter publication supabase_realtime add table public.predictions;
alter publication supabase_realtime add table public.models;
