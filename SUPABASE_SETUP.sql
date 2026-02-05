-- ==========================================
-- UUID Generator Project: Supabase Setup History
-- ==========================================

-- ---------------------------------------------------------
-- PHASE 1: 基本構造の構築
-- ---------------------------------------------------------

-- 1. UUIDを保存するメインテーブル (表示用)
CREATE TABLE public.generated_uuids (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id text,
    is_gift boolean DEFAULT false
);

-- 2. 高速な統計取得用のカウンターテーブル
CREATE TABLE public.counters (
    name text PRIMARY KEY,
    count bigint DEFAULT 0
);

-- 3. カウンターの初期化
INSERT INTO public.counters (name, count) VALUES ('total_generated', 0), ('collisions', 0) ON CONFLICT DO NOTHING;

-- 4. 合計値を更新するためのトリガー関数
CREATE OR REPLACE FUNCTION increment_total_counter()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.counters SET count = count + 1 WHERE name = 'total_generated';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. 衝突回数を更新するためのRPC関数
CREATE OR REPLACE FUNCTION increment_collision_counter()
RETURNS void AS $$
BEGIN
    UPDATE public.counters SET count = count + 1 WHERE name = 'collisions';
END;
$$ LANGUAGE plpgsql;

-- 6. インサート時に自動で合計値を増やすトリガー
CREATE TRIGGER tr_increment_total
AFTER INSERT ON public.generated_uuids
FOR EACH ROW EXECUTE FUNCTION increment_total_counter();

-- 7. リアルタイム配信（Live Stream）を有効化
-- ※SQL Editor または Supabase Dashboard > Replication から設定
-- alter publication supabase_realtime add table generated_uuids;

-- 8. 履歴取得を高速化するためのインデックス
CREATE INDEX idx_uuids_created_at ON public.generated_uuids (created_at DESC);


-- ---------------------------------------------------------
-- PHASE 2: 最適化と自動生成 (pg_cron)
-- ---------------------------------------------------------

-- 1. 拡張機能を有効化
create extension if not exists pg_cron;

-- 2. アーカイブ用テーブル作成 (全期間の衝突判定用・軽量)
create table if not exists public.uuid_archive (
    uuid uuid primary key
);

-- 3. システム自動生成関数 (1秒おきに実行される本体)
create or replace function public.generate_system_uuid()
returns void as $$
declare
  new_uuid uuid := gen_random_uuid();
begin
  -- 表示用テーブルへの挿入 (Live Stream用)
  insert into public.generated_uuids (uuid, client_id, is_gift)
  values (new_uuid, 'SYSTEM_GENERATOR', false);
  
  -- アーカイブ用テーブルへの挿入 (永続的な衝突チェック)
  begin
    insert into public.uuid_archive (uuid) values (new_uuid);
  exception when unique_violation then
    -- 衝突した場合にカウンターを増やす
    perform public.increment_collision_counter();
  end;
end;
$$ language plpgsql security definer;

-- 4. 掃除用関数の作成 (ストレージ容量の節約)
create or replace function public.cleanup_display_uuids()
returns void as $$
begin
  -- 表示用テーブルを最新1000件に制限
  delete from public.generated_uuids 
  where id not in (
    select id from public.generated_uuids 
    order by created_at desc 
    limit 1000
  );
  
  -- pg_cron自体の実行ログも1日前より古いものは消す
  delete from cron.job_run_details where start_time < now() - interval '1 day';
end;
$$ language plpgsql security definer;

-- 5. スケジュール登録
-- 既に登録されている場合は一度解除して再登録
do $$
begin
    perform cron.unschedule(jobname) from cron.job where jobname in ('system-uuid-gen', 'display-cleanup');
exception when others then end $$;

-- 2秒おきに生成、10分おきに掃除
select cron.schedule('system-uuid-gen', '2 seconds', 'select generate_system_uuid()');
select cron.schedule('display-cleanup', '*/10 * * * *', 'select cleanup_display_uuids()');


-- ---------------------------------------------------------
-- 管理用コマンド
-- ---------------------------------------------------------

-- システム生成を一時停止する
-- select cron.unschedule('system-uuid-gen');

-- システム生成を再開する
-- select cron.schedule('system-uuid-gen', '2 seconds', 'select generate_system_uuid()');

-- クリーンアップを停止する (削除したくなくなった場合)
-- select cron.unschedule('display-cleanup');
