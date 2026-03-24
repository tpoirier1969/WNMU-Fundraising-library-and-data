
-- Pledge Manager Starter Schema v0.1.0
-- Target: Supabase / PostgreSQL
-- Notes:
-- - Designed to live in the SAME Supabase project as the WNMU Program Library
-- - Uses separate pledge_* tables
-- - Stores both exact runtime and rounded board runtime
-- - Models break structure via ordered segment rows

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- Lookup / helper enums
-- -------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from pg_type where typname = 'pledge_segment_type') then
        create type pledge_segment_type as enum (
            'program',
            'fundraising',
            'local_cut_in',
            'open',
            'close',
            'interstitial',
            'other'
        );
    end if;

    if not exists (select 1 from pg_type where typname = 'pledge_break_style') then
        create type pledge_break_style as enum (
            'HDPL',
            'HDPE',
            'LIVE',
            'OTHER'
        );
    end if;

    if not exists (select 1 from pg_type where typname = 'pledge_record_status') then
        create type pledge_record_status as enum (
            'active',
            'archived'
        );
    end if;

    if not exists (select 1 from pg_type where typname = 'pledge_fundraiser_status') then
        create type pledge_fundraiser_status as enum (
            'draft',
            'planned',
            'active',
            'closed',
            'archived'
        );
    end if;

    if not exists (select 1 from pg_type where typname = 'pledge_import_status') then
        create type pledge_import_status as enum (
            'uploaded',
            'parsed',
            'matched',
            'review_needed',
            'completed',
            'failed'
        );
    end if;

    if not exists (select 1 from pg_type where typname = 'pledge_match_status') then
        create type pledge_match_status as enum (
            'unmatched',
            'auto_matched',
            'manual_matched',
            'ignored'
        );
    end if;
end $$;

-- -------------------------------------------------------------------
-- Title master
-- -------------------------------------------------------------------

create table if not exists pledge_programs (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    title_normalized text generated always as (regexp_replace(lower(coalesce(title, '')), '[^a-z0-9]+', '', 'g')) stored,
    short_title text,
    alternate_titles text,
    nola_code text,
    distributor text,
    producer text,
    topic_primary text,
    topic_secondary text,
    board_runtime_minutes integer,
    exact_runtime interval,
    program_notes text,
    rights_start date,
    rights_end date,
    rights_notes text,
    premium_summary text,
    source_format text,
    pickup_type text,
    storage_location text,
    status pledge_record_status not null default 'active',
    times_aired_count integer not null default 0,
    lifetime_dollars numeric(12,2) not null default 0,
    lifetime_pledges integer not null default 0,
    last_aired_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_pledge_programs_title_norm on pledge_programs(title_normalized);
create index if not exists idx_pledge_programs_status on pledge_programs(status);
create index if not exists idx_pledge_programs_nola on pledge_programs(nola_code);

create table if not exists pledge_program_aliases (
    id uuid primary key default gen_random_uuid(),
    pledge_program_id uuid not null references pledge_programs(id) on delete cascade,
    alias_title text not null,
    alias_normalized text generated always as (regexp_replace(lower(coalesce(alias_title, '')), '[^a-z0-9]+', '', 'g')) stored,
    created_at timestamptz not null default now()
);

create index if not exists idx_pledge_program_aliases_norm on pledge_program_aliases(alias_normalized);

-- -------------------------------------------------------------------
-- Program versions
-- -------------------------------------------------------------------

create table if not exists pledge_program_versions (
    id uuid primary key default gen_random_uuid(),
    pledge_program_id uuid not null references pledge_programs(id) on delete cascade,
    version_label text not null,
    break_style pledge_break_style not null default 'OTHER',
    board_runtime_minutes integer not null,
    exact_runtime interval,
    has_national_pledge_breaks boolean not null default false,
    has_local_cut_in_opportunities boolean not null default false,
    default_break_count integer,
    default_local_cut_in_count integer,
    version_notes text,
    status pledge_record_status not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (pledge_program_id, version_label)
);

create index if not exists idx_pledge_program_versions_program on pledge_program_versions(pledge_program_id);

-- -------------------------------------------------------------------
-- Segment map (program section / fundraising section / local cut-in)
-- -------------------------------------------------------------------

create table if not exists pledge_program_segments (
    id uuid primary key default gen_random_uuid(),
    pledge_program_version_id uuid not null references pledge_program_versions(id) on delete cascade,
    segment_order integer not null,
    segment_type pledge_segment_type not null,
    label text not null,
    duration interval,
    duration_minutes numeric(8,2),
    local_cut_in_available boolean not null default false,
    is_optional boolean not null default false,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (pledge_program_version_id, segment_order)
);

create index if not exists idx_pledge_program_segments_version on pledge_program_segments(pledge_program_version_id);

-- -------------------------------------------------------------------
-- Premiums
-- -------------------------------------------------------------------

create table if not exists pledge_premiums (
    id uuid primary key default gen_random_uuid(),
    pledge_program_id uuid not null references pledge_programs(id) on delete cascade,
    premium_name text not null,
    premium_type text,
    ask_amount numeric(12,2),
    description text,
    fulfillment_notes text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------------
-- Fundraisers
-- -------------------------------------------------------------------

create table if not exists pledge_fundraisers (
    id uuid primary key default gen_random_uuid(),
    fundraiser_name text not null,
    season_label text,
    calendar_year integer,
    start_date date not null,
    end_date date not null,
    pbs_core_start_date date,
    pbs_core_end_date date,
    fundraising_overnight boolean not null default false,
    fundraising_morning boolean not null default false,
    fundraising_daytime boolean not null default true,
    fundraising_evening boolean not null default true,
    fundraising_late_night boolean not null default true,
    notes text,
    status pledge_fundraiser_status not null default 'draft',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chk_pledge_fundraiser_dates check (end_date >= start_date)
);

create index if not exists idx_pledge_fundraisers_dates on pledge_fundraisers(start_date, end_date);

create table if not exists pledge_fundraiser_blackouts (
    id uuid primary key default gen_random_uuid(),
    pledge_fundraiser_id uuid not null references pledge_fundraisers(id) on delete cascade,
    blackout_date date not null,
    start_time time,
    end_time time,
    reason text,
    created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------
-- Scheduled airings
-- -------------------------------------------------------------------

create table if not exists pledge_scheduled_airings (
    id uuid primary key default gen_random_uuid(),
    pledge_fundraiser_id uuid not null references pledge_fundraisers(id) on delete cascade,
    pledge_program_id uuid not null references pledge_programs(id) on delete restrict,
    pledge_program_version_id uuid references pledge_program_versions(id) on delete set null,
    air_date date not null,
    start_time time not null,
    end_time time not null,
    board_runtime_minutes integer not null,
    exact_runtime interval,
    is_live boolean not null default false,
    is_blackout_override boolean not null default false,
    status text not null default 'scheduled',
    placement_notes text,
    imported_from_previous_fundraiser_id uuid references pledge_scheduled_airings(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_pledge_scheduled_airings_fundraiser on pledge_scheduled_airings(pledge_fundraiser_id, air_date, start_time);
create index if not exists idx_pledge_scheduled_airings_program on pledge_scheduled_airings(pledge_program_id);

-- Optional override structure for a specific airing
create table if not exists pledge_airing_segment_overrides (
    id uuid primary key default gen_random_uuid(),
    pledge_scheduled_airing_id uuid not null references pledge_scheduled_airings(id) on delete cascade,
    segment_order integer not null,
    segment_type pledge_segment_type not null,
    label text not null,
    duration interval,
    duration_minutes numeric(8,2),
    local_cut_in_available boolean not null default false,
    is_optional boolean not null default false,
    notes text,
    created_at timestamptz not null default now(),
    unique (pledge_scheduled_airing_id, segment_order)
);

-- -------------------------------------------------------------------
-- Results by airing
-- -------------------------------------------------------------------

create table if not exists pledge_airing_results (
    id uuid primary key default gen_random_uuid(),
    pledge_scheduled_airing_id uuid not null references pledge_scheduled_airings(id) on delete cascade,
    on_air_dollars numeric(12,2) not null default 0,
    online_dollars numeric(12,2) not null default 0,
    mail_dollars numeric(12,2) not null default 0,
    other_dollars numeric(12,2) not null default 0,
    total_dollars numeric(12,2) generated always as (coalesce(on_air_dollars,0) + coalesce(online_dollars,0) + coalesce(mail_dollars,0) + coalesce(other_dollars,0)) stored,
    on_air_pledges integer not null default 0,
    online_pledges integer not null default 0,
    mail_pledges integer not null default 0,
    other_pledges integer not null default 0,
    total_pledges integer generated always as (coalesce(on_air_pledges,0) + coalesce(online_pledges,0) + coalesce(mail_pledges,0) + coalesce(other_pledges,0)) stored,
    premium_count integer not null default 0,
    sustainer_count integer not null default 0,
    needs_review boolean not null default false,
    result_notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (pledge_scheduled_airing_id)
);

-- -------------------------------------------------------------------
-- Import tracking
-- -------------------------------------------------------------------

create table if not exists pledge_report_imports (
    id uuid primary key default gen_random_uuid(),
    pledge_fundraiser_id uuid not null references pledge_fundraisers(id) on delete cascade,
    original_filename text not null,
    workbook_format text,
    parser_version text,
    import_status pledge_import_status not null default 'uploaded',
    import_notes text,
    imported_at timestamptz not null default now()
);

create table if not exists pledge_report_import_rows (
    id uuid primary key default gen_random_uuid(),
    pledge_report_import_id uuid not null references pledge_report_imports(id) on delete cascade,
    source_sheet_name text,
    raw_air_date date,
    raw_air_time text,
    raw_break_time text,
    raw_nola_code text,
    raw_program_title text,
    raw_program_number text,
    raw_break_code text,
    raw_break_minutes text,
    raw_program_minutes integer,
    raw_dollars numeric(12,2),
    raw_pledges integer,
    raw_premium_count integer,
    raw_sustainer_count integer,
    matched_pledge_scheduled_airing_id uuid references pledge_scheduled_airings(id) on delete set null,
    match_status pledge_match_status not null default 'unmatched',
    match_confidence numeric(5,2),
    review_notes text,
    created_at timestamptz not null default now()
);

create index if not exists idx_pledge_report_import_rows_import on pledge_report_import_rows(pledge_report_import_id);
create index if not exists idx_pledge_report_import_rows_match on pledge_report_import_rows(match_status, match_confidence);

-- -------------------------------------------------------------------
-- Helpful views
-- -------------------------------------------------------------------

create or replace view pledge_program_library_summary as
select
    p.id,
    p.title,
    p.nola_code,
    p.distributor,
    p.topic_primary,
    p.board_runtime_minutes,
    p.exact_runtime,
    p.premium_summary,
    p.status,
    count(distinct v.id) as version_count,
    coalesce(sum(case when s.segment_type = 'fundraising' then 1 else 0 end), 0) as break_count,
    coalesce(sum(case when s.local_cut_in_available then 1 else 0 end), 0) as local_cut_in_count,
    p.times_aired_count,
    p.lifetime_dollars,
    p.lifetime_pledges,
    p.last_aired_at
from pledge_programs p
left join pledge_program_versions v on v.pledge_program_id = p.id
left join pledge_program_segments s on s.pledge_program_version_id = v.id
group by
    p.id, p.title, p.nola_code, p.distributor, p.topic_primary, p.board_runtime_minutes,
    p.exact_runtime, p.premium_summary, p.status, p.times_aired_count,
    p.lifetime_dollars, p.lifetime_pledges, p.last_aired_at;

create or replace view pledge_fundraiser_schedule_summary as
select
    f.id as fundraiser_id,
    f.fundraiser_name,
    a.air_date,
    a.start_time,
    a.end_time,
    a.board_runtime_minutes,
    a.is_live,
    p.title,
    p.nola_code,
    p.distributor,
    p.premium_summary,
    r.total_dollars,
    r.total_pledges,
    r.needs_review
from pledge_fundraisers f
join pledge_scheduled_airings a on a.pledge_fundraiser_id = f.id
join pledge_programs p on p.id = a.pledge_program_id
left join pledge_airing_results r on r.pledge_scheduled_airing_id = a.id;

-- -------------------------------------------------------------------
-- Trigger helpers
-- -------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

do $$
begin
    if not exists (select 1 from pg_trigger where tgname = 'trg_pledge_programs_updated_at') then
        create trigger trg_pledge_programs_updated_at before update on pledge_programs
        for each row execute function set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_pledge_program_versions_updated_at') then
        create trigger trg_pledge_program_versions_updated_at before update on pledge_program_versions
        for each row execute function set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_pledge_program_segments_updated_at') then
        create trigger trg_pledge_program_segments_updated_at before update on pledge_program_segments
        for each row execute function set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_pledge_premiums_updated_at') then
        create trigger trg_pledge_premiums_updated_at before update on pledge_premiums
        for each row execute function set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_pledge_fundraisers_updated_at') then
        create trigger trg_pledge_fundraisers_updated_at before update on pledge_fundraisers
        for each row execute function set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_pledge_scheduled_airings_updated_at') then
        create trigger trg_pledge_scheduled_airings_updated_at before update on pledge_scheduled_airings
        for each row execute function set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_pledge_airing_results_updated_at') then
        create trigger trg_pledge_airing_results_updated_at before update on pledge_airing_results
        for each row execute function set_updated_at();
    end if;
end $$;
