
CREATE TABLE public.app_storage (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.app_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.app_storage FOR SELECT USING (true);
CREATE POLICY "Public insert access" ON public.app_storage FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access" ON public.app_storage FOR UPDATE USING (true);
CREATE POLICY "Public delete access" ON public.app_storage FOR DELETE USING (true);
