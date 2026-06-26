-- ============================================================
-- Cement Distribution System - Database Schema
-- Target: PostgreSQL / Supabase
-- ============================================================

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- MODULE 1: BASE ENTITIES
-- ============================================================

create table factories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  location    text,
  created_at  timestamptz not null default now()
);

create table regions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table transporters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  phone       text,
  created_at  timestamptz not null default now()
);

create table transport_rates (
  id            uuid primary key default gen_random_uuid(),
  factory_id    uuid not null references factories(id) on delete cascade,
  region_id     uuid not null references regions(id) on delete cascade,
  rate_per_ton  numeric(10,2) not null check (rate_per_ton >= 0),
  created_at    timestamptz not null default now(),
  unique (factory_id, region_id)
);

-- كل مصنع له كتالوج مسميات مستقل بالكامل (لا تشارك بين المصانع).
-- standard_trip_weight = الوزن القياسي للنقلة/الشحنة لهذا المسمى
-- (المرجع الافتراضي الذي يُستخدم في تعبئة planned_weight_per_trip بالمخطط اليومي).
create table factory_products (
  id                    uuid primary key default gen_random_uuid(),
  factory_id            uuid not null references factories(id) on delete restrict,
  name                  text not null,                          -- مثال: '52 معبأ'
  standard_trip_weight  numeric(10,2) check (standard_trip_weight > 0), -- اختياري: كوزن احتياطي فقط
  unit                  text not null default 'طن',
  is_active             boolean not null default true,          -- تعطيل مسمى قديم بدل حذفه
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (factory_id, name)
);

create trigger trg_factory_products_updated_at
  before update on factory_products
  for each row execute function set_updated_at();

create index idx_factory_products_factory on factory_products(factory_id);

-- ============================================================
-- MODULE: DOCUMENTS & STORAGE (يجب أن تسبق Purchases/Daily Plans)
-- ============================================================

create type document_type as enum (
  'DAILY_PLAN',
  'PROOF',
  'INVOICE',
  'PURCHASE_ORDER'
);

create type extraction_status as enum (
  'pending',
  'needs_review',
  'confirmed',
  'rejected'
);

create table files (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null,
  file_type     text not null check (file_type in ('pdf','excel','image','other')),
  storage_path  text not null,
  upload_date   timestamptz not null default now(),
  uploaded_by   text
);

-- ============================================================
-- MODULE 2: PURCHASES
-- ============================================================
-- factory_id غير موجود هنا عمدًا — يُستدل عليه من
-- product_id -> factory_products.factory_id (مسمى واحد = مصنع واحد دايمًا).

create table purchases (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references factory_products(id) on delete restrict,
  region_id       uuid references regions(id) on delete set null,
  purchase_date   date not null,
  quantity_tons   numeric(10,2) not null check (quantity_tons > 0),
  price_per_ton   numeric(10,2),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_purchases_updated_at
  before update on purchases
  for each row execute function set_updated_at();

create index idx_purchases_product   on purchases(product_id);
create index idx_purchases_region    on purchases(region_id);
create index idx_purchases_date      on purchases(purchase_date);

-- ============================================================
-- MODULE 3: DAILY PLANS
-- ============================================================

create table daily_plans (
  id                       uuid primary key default gen_random_uuid(),
  product_id               uuid not null references factory_products(id) on delete restrict,
  region_id                uuid not null references regions(id) on delete restrict,
  plan_date                date not null,
  planned_trips            integer not null check (planned_trips >= 0),
  planned_weight_per_trip  numeric(10,2) not null check (planned_weight_per_trip >= 0), -- يُستخلص مباشرة من حقل "الكمية" في مخطط التحميلات
  source_file_id           uuid references files(id) on delete set null,
  status                   text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger trg_daily_plans_updated_at
  before update on daily_plans
  for each row execute function set_updated_at();

create index idx_daily_plans_product  on daily_plans(product_id);
create index idx_daily_plans_region   on daily_plans(region_id);
create index idx_daily_plans_date     on daily_plans(plan_date);

-- ============================================================
-- MODULE 4: TRIPS
-- ============================================================

create table trips (
  id                        uuid primary key default gen_random_uuid(),
  purchase_id               uuid references purchases(id) on delete restrict, -- nullable to support flexible entry
  daily_plan_id             uuid references daily_plans(id) on delete set null,
  region_id                 uuid not null references regions(id) on delete restrict,
  transporter_id            uuid references transporters(id) on delete restrict,
  trip_date                 date not null,
  planned_weight_tons       numeric(10,2),
  loaded_weight_tons        numeric(10,2) not null check (loaded_weight_tons >= 0),
  unit_purchase_price       numeric(10,2),                                       -- سعر شراء الطن الفعلي لهذه الرحلة (الوصال)
  unit_transport_rate       numeric(10,2),                                       -- نولون النقل الفعلي للطن
  driver_commission         numeric(10,2) not null default 0,                    -- عمولة السائق
  extra_expenses            numeric(10,2) not null default 0,                    -- مصاريف إضافية
  sales_order_number        text,
  loading_permission_number text,
  waybill_number            text,
  driver_name               text,
  driver_phone              text,
  vehicle_plate             text,
  trailer_plate             text,
  transport_company         text,                                                -- اسم شركة النقل (للتوافق مع النص الخام)
  receiver_name             text,
  receiver_phone            text,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger trg_trips_updated_at
  before update on trips
  for each row execute function set_updated_at();

create index idx_trips_purchase    on trips(purchase_id);
create index idx_trips_daily_plan  on trips(daily_plan_id);
create index idx_trips_region      on trips(region_id);
create index idx_trips_date        on trips(trip_date);
create index idx_trips_loading_permission on trips(loading_permission_number);
create index idx_trips_sales_order        on trips(sales_order_number);

-- ============================================================
-- MODULE 5: DOCUMENT EXTRACTIONS
-- ============================================================

create table document_extractions (
  id                       uuid primary key default gen_random_uuid(),
  file_id                  uuid not null references files(id) on delete cascade,
  document_type            document_type not null,
  extracted_json           jsonb not null,
  status                   extraction_status not null default 'pending',
  confirmed_purchase_id    uuid references purchases(id) on delete set null,
  confirmed_daily_plan_id  uuid references daily_plans(id) on delete set null,
  confirmed_trip_id        uuid references trips(id) on delete set null,
  reviewed_by              text,
  reviewed_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger trg_document_extractions_updated_at
  before update on document_extractions
  for each row execute function set_updated_at();

create index idx_doc_extractions_file    on document_extractions(file_id);
create index idx_doc_extractions_status  on document_extractions(status);
create index idx_doc_extractions_trip    on document_extractions(confirmed_trip_id);

-- ============================================================
-- MODULE 6: FACTORY DEPOSITS (إيداعات المصانع)
-- ============================================================

create table factory_deposits (
  id              uuid primary key default gen_random_uuid(),
  factory_id      uuid not null references factories(id) on delete restrict,
  deposit_date    date not null,
  amount          numeric(12,2) not null check (amount > 0),
  payment_method  text not null default 'bank_transfer' check (payment_method in ('bank_transfer', 'cash', 'cheque', 'other')),
  reference_no    text,                               -- رقم الحوالة أو الشيك
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_factory_deposits_updated_at
  before update on factory_deposits
  for each row execute function set_updated_at();

create index idx_factory_deposits_factory on factory_deposits(factory_id);
create index idx_factory_deposits_date    on factory_deposits(deposit_date);

-- ============================================================
-- MODULE 7: DRIVER PAYMENTS & COMMISSION (رواتب وعمولات السائقين)
-- ============================================================

create table driver_payments (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid references trips(id) on delete set null,
  driver_name     text not null,
  driver_phone    text,
  payment_date    date not null,
  amount          numeric(10,2) not null check (amount >= 0),
  status          text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_driver_payments_updated_at
  before update on driver_payments
  for each row execute function set_updated_at();

create index idx_driver_payments_trip   on driver_payments(trip_id);
create index idx_driver_payments_driver on driver_payments(driver_name);

-- ============================================================
-- MODULE 8: TRANSPORTER PAYMENTS (مدفوعات شركات النقل)
-- ============================================================

create table transporter_payments (
  id              uuid primary key default gen_random_uuid(),
  transporter_id  uuid not null references transporters(id) on delete restrict,
  payment_date    date not null,
  amount          numeric(12,2) not null check (amount > 0),
  payment_method  text not null default 'bank_transfer' check (payment_method in ('bank_transfer', 'cash', 'cheque', 'other')),
  reference_no    text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_transporter_payments_updated_at
  before update on transporter_payments
  for each row execute function set_updated_at();

create index idx_transporter_payments_transporter on transporter_payments(transporter_id);

-- ============================================================
-- VIEWS
-- ============================================================

create or replace view purchase_summary as
select
  pu.id                                                                                   as purchase_id,
  f.name                                                                                  as factory_name,
  fp.name                                                                                 as product_name,
  fp.standard_trip_weight                                                                 as standard_trip_weight,
  r.name                                                                                  as region_name,
  pu.purchase_date,
  pu.quantity_tons                                                                        as purchased_tons,
  coalesce(sum(t.loaded_weight_tons), 0)                                                  as loaded_tons,
  count(t.id)                                                                             as trips_count,
  coalesce(sum(greatest(coalesce(t.planned_weight_tons,0) - t.loaded_weight_tons, 0)), 0) as deficit_tons,
  pu.quantity_tons - coalesce(sum(t.loaded_weight_tons), 0)                               as remaining_tons
from purchases pu
join factory_products fp on fp.id = pu.product_id
join factories f          on f.id = fp.factory_id
left join trips t        on t.purchase_id = pu.id
left join regions r      on r.id = pu.region_id
group by pu.id, f.name, fp.name, fp.standard_trip_weight, r.name, pu.purchase_date, pu.quantity_tons;


create or replace view factory_product_summary as
select
  f.id                                                                                    as factory_id,
  f.name                                                                                  as factory_name,
  fp.id                                                                                   as product_id,
  fp.name                                                                                 as product_name,
  count(distinct t.region_id)                                                             as regions_count,
  count(t.id)                                                                             as total_trips,
  coalesce(sum(t.loaded_weight_tons), 0)                                                  as total_loaded_tons,
  coalesce(sum(greatest(coalesce(t.planned_weight_tons,0) - t.loaded_weight_tons, 0)), 0) as total_deficit_tons
from trips t
join purchases pu        on pu.id = t.purchase_id
join factory_products fp on fp.id = pu.product_id
join factories f         on f.id = fp.factory_id
group by f.id, f.name, fp.id, fp.name;


create or replace view daily_plan_vs_actual as
select
  dp.id                        as daily_plan_id,
  dp.plan_date,
  f.name                       as factory_name,
  fp.name                      as product_name,
  r.name                       as region_name,
  dp.planned_trips,
  dp.planned_weight_per_trip,
  count(t.id)                  as actual_trips,
  coalesce(sum(t.loaded_weight_tons), 0) as actual_loaded_tons
from daily_plans dp
join factory_products fp on fp.id = dp.product_id
join factories f          on f.id = fp.factory_id
left join trips t        on t.daily_plan_id = dp.id
left join regions r      on r.id = dp.region_id
group by dp.id, dp.plan_date, f.name, fp.name, r.name, dp.planned_trips, dp.planned_weight_per_trip;


create or replace view factory_financial_ledger as
with trip_financials as (
  select 
    t.id as trip_id,
    pu.id as purchase_id,
    fp.factory_id,
    t.trip_date as trans_date,
    (coalesce(t.planned_weight_tons, 0) * coalesce(t.unit_purchase_price, pu.price_per_ton, 0)) as planned_debit,
    greatest(coalesce(t.planned_weight_tons,0) - t.loaded_weight_tons, 0) as deficit_tons,
    (greatest(coalesce(t.planned_weight_tons,0) - t.loaded_weight_tons, 0) * coalesce(t.unit_purchase_price, pu.price_per_ton, 0)) as refund_credit,
    (t.loaded_weight_tons * coalesce(t.unit_purchase_price, pu.price_per_ton, 0)) as actual_debit,
    t.waybill_number,
    t.loading_permission_number
  from trips t
  left join purchases pu on t.purchase_id = pu.id
  left join daily_plans dp on t.daily_plan_id = dp.id
  join factory_products fp on fp.id = coalesce(pu.product_id, dp.product_id)
),
union_ledger as (
  select 
    factory_id,
    deposit_date as trans_date,
    'deposit' as type,
    reference_no as doc_no,
    amount as credit,
    0.00 as debit,
    amount as net_amount,
    'إيداع نقدي/حوالة رقم: ' || coalesce(reference_no, '') as notes
  from factory_deposits
  
  union all
  
  select 
    factory_id,
    trans_date,
    'loading_deduction' as type,
    coalesce(waybill_number, loading_permission_number) as doc_no,
    0.00 as credit,
    actual_debit as debit,
    -actual_debit as net_amount,
    'شحنة رقم: ' || coalesce(waybill_number, '') || 
    ' | خصم مخطط لـ (' || coalesce((select planned_weight_tons from trips where id = trip_id), 0) || ' طن)' ||
    ' | مرتجع عجز لـ (' || deficit_tons || ' طن) بقيمة ' || refund_credit || ' ج.م' as notes
  from trip_financials
)
select 
  factory_id,
  trans_date,
  type,
  doc_no,
  credit,
  debit,
  net_amount,
  sum(net_amount) over (partition by factory_id order by trans_date, type, doc_no) as running_balance,
  notes
from union_ledger;