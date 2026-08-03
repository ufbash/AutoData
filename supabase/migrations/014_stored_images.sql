ALTER TABLE sightings ADD COLUMN IF NOT EXISTS stored_image_urls jsonb;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS images_stored_at timestamptz;
ALTER TABLE sightings ADD COLUMN IF NOT EXISTS image_store_status text;

-- Create private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-images', 'vehicle-images', false)
ON CONFLICT (id) DO NOTHING;

-- Guarded RLS enablement on storage.objects
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'storage' 
          AND c.relname = 'objects' 
          AND c.relrowsecurity = true
    ) THEN
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- Policies for vehicle-images bucket
DROP POLICY IF EXISTS "vehicle_images_service_role" ON storage.objects;
CREATE POLICY "vehicle_images_service_role" ON storage.objects
  FOR ALL
  USING (bucket_id = 'vehicle-images' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'vehicle-images' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "vehicle_images_authenticated_select" ON storage.objects;
CREATE POLICY "vehicle_images_authenticated_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'vehicle-images' 
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 
      FROM public.memberships 
      WHERE memberships.user_id = auth.uid() 
        AND memberships.org_id::text = (storage.foldername(name))[1]
    )
  );
