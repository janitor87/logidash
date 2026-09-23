-- ============================================================
-- LOGIX PLATFORM - Supabase Production Database Schema
-- ============================================================

DO $$ BEGIN
    CREATE TYPE cargo_status AS ENUM ('active', 'completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    truck_type VARCHAR(100) NOT NULL,
    trucks_count INTEGER DEFAULT 1 NOT NULL CHECK (trucks_count > 0 AND trucks_count <= 50),
    product VARCHAR(150) NOT NULL,
    weight VARCHAR(50) NOT NULL,
    
    loading_location VARCHAR(255) NOT NULL,
    unloading_location VARCHAR(255) NOT NULL,
    loading_date DATE NOT NULL,
    unloading_date DATE,
    
    payment_terms VARCHAR(150),
    contact_phone VARCHAR(50) DEFAULT '+380989749954',
    
    customs_clearance_out VARCHAR(255),
    customs_clearance_in VARCHAR(255),
    
    price VARCHAR(100),
    notes TEXT,
    status cargo_status DEFAULT 'active' NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipments_status ON public.shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_loading_date ON public.shipments(loading_date ASC);
CREATE INDEX IF NOT EXISTS idx_shipments_truck_type ON public.shipments(truck_type);

CREATE OR REPLACE FUNCTION archive_expired_shipments() 
RETURNS TRIGGER AS $$
BEGIN
    -- Guard against infinite recursion: the UPDATE below fires this very
    -- trigger again (AFTER UPDATE ... FOR EACH STATEMENT). Without this
    -- check, every INSERT/UPDATE/DELETE on public.shipments causes
    -- unbounded recursive trigger invocations and Postgres aborts the
    -- statement with "stack depth limit exceeded" (verified in testing).
    -- Only allow the archiving logic to actually run at the outermost
    -- trigger invocation.
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    UPDATE public.shipments
    SET status = 'completed',
        updated_at = timezone('utc'::text, now())
    WHERE status = 'active' 
      AND loading_date < (CURRENT_DATE - INTERVAL '3 days');
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_archive_expired ON public.shipments;
CREATE TRIGGER trg_archive_expired
AFTER INSERT OR UPDATE OR DELETE ON public.shipments
FOR EACH STATEMENT
EXECUTE FUNCTION archive_expired_shipments();

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Access" ON public.shipments;
CREATE POLICY "Public Read Access" 
ON public.shipments FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Full Access For App" ON public.shipments;
CREATE POLICY "Full Access For App" 
ON public.shipments FOR ALL 
USING (true) 
WITH CHECK (true);
