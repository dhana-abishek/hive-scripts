const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CSV_URL =
  "https://hive-technologies.metabaseapp.com/public/question/a74bb567-12c7-46b9-a7ee-82ce02f698ee.csv";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const response = await fetch(CSV_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!response.ok) {
      throw new Error(`Metabase returned ${response.status}`);
    }

    const text = await response.text();

    return new Response(text, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
      },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
