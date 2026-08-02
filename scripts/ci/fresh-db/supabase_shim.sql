-- محاكاة بيئة Supabase الدنيا لاختبار بناء قاعدة فارغة
--
-- service_role في Supabase Production يحمل `rolbypassrls = true`. الشيم كان
-- ينشئه دورًا عاديًا، فتُطبَّق عليه RLS في Fresh DB وحدها. والفارق لا يُظهر
-- نفسه رفضًا بل **ترشيحًا صامتًا**: عبارة UPDATE/DELETE على جدول بلا سياسة
-- مطابقة تنتهي بصفر صفوف بلا خطأ، فلا يُستدعى أي trigger دفاعي، فتمر بوابة
-- تظن أنها أثبتت حارسًا بينما لم يُشغَّل الحارس أصلًا.
--
-- والأدوار عنقودية بينما مخططات auth وstorage محلية لكل قاعدة، فبوابة تبني
-- قاعدتين في عنقود واحد كانت تحذف أسطر CREATE ROLE بـsed مثبَّت على نص السطر
-- حرفيًا. إنشاء الأدوار هنا صار idempotent بذاته، فلا يبقى عقد نصي هش بين
-- الشيم وأي سكربت بوابة.
DO $shim_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  ELSE
    ALTER ROLE service_role BYPASSRLS;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION
      'SHIM_SERVICE_ROLE_BYPASSRLS_MISSING: fresh DB does not mirror Supabase production';
  END IF;
END
$shim_roles$;

-- supabase_admin لا يستقبل صلاحيات في المخطط، لكنه يظهر بوصفه **المانح** في
-- الصلاحيات الافتراضية التي يُصدرها pg_dump بعد استعادة ACL:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     GRANT ALL ON SEQUENCES TO postgres;
--
-- وبيان كهذا يفشل بـ`role "supabase_admin" does not exist` قبل أن يبلغ أي منح.
-- فحص المستفيدين وحده لا يكشفه — المانح عمود آخر في pg_default_acl.
DO $shim_admin_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN;
  END IF;
END
$shim_admin_role$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
-- اسم القاعدة يُشتق من الاتصال الحالي لا يُثبَّت نصًا. كان مثبتًا على
-- `wardah_fresh`، فنجح في ci-cd.yml وفشل في generate-baseline.yml الذي ينشئ
-- `wardah_baseline_verify` — عقد ضمني بين ملف SQL واسم قاعدة في workflow آخر.
DO $wardah_shim$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path = public, extensions',
    current_database()
  );
END
$wardah_shim$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
    id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id),
    name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
